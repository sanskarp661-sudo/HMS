<?php
/**
 * api_erp.php — Kitchen ERP modules for Mosaic Engine HMS
 *
 * Included by api.php (never called directly). Adds:
 *   Recipe costing & menu engineering · Stock counts, transfers, expiry ·
 *   Wastage with approval & reuse · Production, labels, dispatch, prep list ·
 *   PO vendor scorecard · Kitchen stations · Takeaway / delivery / Swiggy / Zomato ·
 *   P&L & food cost · Staff & shifts · Food safety · Outlets · Permissions & limits ·
 *   Webhooks for aggregator middleware, IoT sensors and biometric devices.
 */
if (!function_exists('read_json')) { http_response_code(404); exit; }

// ─── Shared helpers ─────────────────────────────────────────────────────────
function material_categories() {
    return ['Veg', 'Grocery', 'Dairy', 'Meat', 'Seafood', 'Beer', 'Liquor', 'Beverage', 'Packaging', 'Semi-finished', 'Other'];
}

function erp_now() { return gmdate("Y-m-d\TH:i:s\Z"); }

function erp_fail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(["status" => "error", "message" => $msg]);
    exit;
}

function erp_input() {
    $in = json_decode(file_get_contents("php://input"), true);
    return is_array($in) ? $in : [];
}

// Running numbers for documents: TA-0001, WST-0001, BAT-0001, DC-0001, TRF-0001 …
function next_doc_no($prefix) {
    $c = read_json("counters.json", []);
    $n = isset($c[$prefix]) ? intval($c[$prefix]) + 1 : 1;
    $c[$prefix] = $n;
    write_json("counters.json", $c);
    return $prefix . "-" . str_pad($n, 4, "0", STR_PAD_LEFT);
}

function inventory_index() {
    $inv = read_json("inventory.json", ["materials" => []]);
    $idx = [];
    foreach ($inv['materials'] as $m) $idx[$m['id']] = $m;
    return $idx;
}

// Cost per unit used for recipes: weighted average (default) or last purchase rate
function material_rate($m) {
    static $basis = null;
    if ($basis === null) $basis = get_settings()['costing_basis'];
    if ($basis === 'last' && !empty($m['last_cost'])) return floatval($m['last_cost']);
    return floatval($m['cost_per_unit']);
}

function kitchen_qty($m) { return isset($m['kitchen_stock']) ? max(0, min(floatval($m['kitchen_stock']), floatval($m['stock']))) : 0; }
function store_qty($m) { return round(floatval($m['stock']) - kitchen_qty($m), 3); }

function recipe_cost_lines($ings, $mats) {
    $cost = 0;
    $lines = [];
    foreach ($ings as $ing) {
        if (!isset($mats[$ing['material_id']])) continue;
        $m = $mats[$ing['material_id']];
        $loss = isset($ing['loss_pct']) ? floatval($ing['loss_pct']) : 0;
        $rate = material_rate($m);
        $c = floatval($ing['qty']) * (1 + $loss / 100) * $rate;
        $cost += $c;
        $lines[] = ["material_id" => $m['id'], "name" => $m['name'], "unit" => $m['unit'], "qty" => floatval($ing['qty']), "loss_pct" => $loss,
                    "rate" => money($rate), "cost" => round($c, 2), "semi" => (isset($m['category']) ? $m['category'] : '') === 'Semi-finished'];
    }
    return [round($cost, 2), $lines];
}

function recipe_cost($item_id, $variant, $mats = null, $bom = null) {
    $mats = $mats === null ? inventory_index() : $mats;
    $bom = $bom === null ? read_json("bom.json", []) : $bom;
    if (!isset($bom[$item_id][$variant])) return null;
    return recipe_cost_lines($bom[$item_id][$variant], $mats)[0];
}

// At billing time the plate cost of every line is saved, so the P&L shows the
// food cost of what was actually sold (even if recipes or prices change later)
function add_cost_snapshot($invoice) {
    $mats = inventory_index();
    $bom = read_json("bom.json", []);
    $total = 0;
    $costed = true;
    foreach ($invoice['items'] as &$it) {
        $c = isset($it['id']) && $it['id'] !== '' ? recipe_cost($it['id'], $it['variant'], $mats, $bom) : null;
        $it['unit_cost'] = $c;
        if ($c === null) $costed = false;
        else $total += $c * intval($it['quantity']);
    }
    unset($it);
    $invoice['food_cost'] = money($total);
    $invoice['food_cost_complete'] = $costed;
    return $invoice;
}

function menu_index() {
    static $idx = null;
    if ($idx !== null) return $idx;
    $md = read_json("menu_data.json", ["categories" => [], "items" => []]);
    $cats = [];
    foreach ($md['categories'] as $c) $cats[$c['id']] = $c;
    $idx = ["items" => [], "cats" => $cats];
    foreach ($md['items'] as $it) $idx['items'][$it['id']] = $it;
    return $idx;
}

// Station, target time, brand and online availability for a menu item
function menu_meta($item_id) {
    $mi = menu_index();
    $it = isset($mi['items'][$item_id]) ? $mi['items'][$item_id] : null;
    $section = ($it && isset($mi['cats'][$it['category_id']])) ? $mi['cats'][$it['category_id']]['section'] : 'food';
    $alc = $it && in_array('Alcoholic', isset($it['tags']) ? $it['tags'] : [], true);
    return [
        "station" => $it && !empty($it['station']) ? $it['station'] : ($section === 'drinks' ? 'Bar' : 'Hot'),
        "target_min" => $it && !empty($it['target_min']) ? intval($it['target_min']) : ($section === 'drinks' ? 3 : 12),
        "brand" => $it && !empty($it['brand']) ? $it['brand'] : get_company_settings()['business_name'],
        "online" => $it ? (!isset($it['online']) ? !$alc : (bool)$it['online']) && !$alc : false,
        "alcoholic" => $alc,
        "section" => $section,
    ];
}

function kitchen_ticket($t) {
    $target = 1;
    foreach ($t['items'] as &$it) {
        $meta = menu_meta(isset($it['id']) ? $it['id'] : '');
        $it['station'] = $meta['station'];
        $it['target_min'] = $meta['target_min'];
        $target = max($target, $meta['target_min']);
    }
    unset($it);
    $t['target_min'] = $target;
    $t['stations'] = array_values(array_unique(array_column($t['items'], 'station')));
    return $t;
}

// Validates a set of payments against a bill total (used by counter orders)
function validate_payments($raw, $total) {
    $allowed = enabled_payment_methods();
    if (!is_array($raw) || count($raw) === 0) erp_fail("Please record how the bill was paid (" . implode(", ", $allowed) . ").");
    $payments = [];
    $paid = 0;
    foreach (array_slice($raw, 0, 50) as $i => $p) {
        $m = isset($p['method']) ? (string)$p['method'] : '';
        $amt = money(isset($p['amount']) ? $p['amount'] : 0);
        if (!in_array($m, $allowed, true)) erp_fail("Payment " . ($i + 1) . ": choose a payment method (" . implode(", ", $allowed) . ").");
        if ($amt <= 0) erp_fail("Payment " . ($i + 1) . ": amount must be more than ₹0.");
        $payments[] = ["label" => isset($p['label']) ? clean_text($p['label'], 30) : "Payment " . ($i + 1), "method" => $m, "amount" => $amt,
                       "reference" => isset($p['reference']) ? clean_text($p['reference'], 40) : ''];
        $paid += $amt;
    }
    if (abs(money($paid) - $total) > 0.01) erp_fail("Payments add up to ₹" . money($paid) . " but the bill total is ₹$total.");
    $methods = array_values(array_unique(array_column($payments, 'method')));
    return [$payments, count($payments) > 1 ? "Split (" . count($payments) . ") · " . implode(" + ", $methods) : $payments[0]['method']];
}

// ─── Takeaway / delivery / Swiggy / Zomato ──────────────────────────────────
function counter_channels() { return ['Takeaway', 'Delivery', 'Swiggy', 'Zomato']; }
function is_aggregator($ch) { return $ch === 'Swiggy' || $ch === 'Zomato'; }

function create_counter_order($channel, $name, $phone, $ref, $address, $raw_items, $raw_payments, $user, $source) {
    if (!in_array($channel, counter_channels(), true)) erp_fail("Unknown order type.");
    $st = get_settings();
    $items = [];
    foreach (is_array($raw_items) ? $raw_items : [] as $ri) {
        $found = lookup_menu_item(isset($ri['id']) ? (string)$ri['id'] : '', isset($ri['variant']) ? (string)$ri['variant'] : '');
        $qty = intval(isset($ri['quantity']) ? $ri['quantity'] : 0);
        if ($found === null || $qty < 1) continue;
        $meta = menu_meta($found['id']);
        // Liquor cannot leave the premises; aggregators only get items switched on for online
        if ($meta['alcoholic']) erp_fail("{$found['name']} is dine-in only — alcohol cannot be sold for takeaway or delivery.");
        if (is_aggregator($channel) && !$meta['online']) erp_fail("{$found['name']} is not available online.");
        if (is_aggregator($channel)) $found['price'] = round($found['price'] * (1 + floatval($st['aggregator_markup']) / 100));
        $found['quantity'] = min($qty, 50);
        $items[] = $found;
    }
    if (count($items) === 0) erp_fail("Add at least one item.");
    if ($st['bom_enabled'] && $st['block_on_low_stock']) {
        $short = bom_shortages(bom_requirements($items));
        if (count($short)) erp_fail("Not enough stock for: " . implode(", ", $short) . ".", 409);
    }
    // No service charge off-premise; GST / VAT as usual
    $bill = compute_bill(["orders" => [["items" => $items]], "service_charge_on" => false, "discount" => null]);
    if (is_aggregator($channel)) {
        // Prepaid on the platform; settled to us later minus commission
        $payments = [["label" => $channel, "method" => $channel, "amount" => $bill['total'], "reference" => $ref]];
        $mode = "$channel (prepaid online)";
    } else {
        list($payments, $mode) = validate_payments($raw_payments, $bill['total']);
    }
    $now = erp_now();
    $invoices = read_json("invoices.json", []);
    $invoice = array_merge($bill, [
        "invoice_id" => "INV-" . time() . "-" . strtoupper(bin2hex(random_bytes(4))),
        "invoice_no" => next_invoice_no($invoices, $st['invoice_prefix']),
        "table_no" => $channel,
        "channel" => $channel,
        "channel_ref" => $ref,
        "delivery_address" => $address,
        "customer_name" => $name !== '' ? $name : ($channel === 'Takeaway' ? 'Walk-in' : 'Guest'),
        "customer_phone" => $phone,
        "timestamp" => $now,
        "seller" => ["name" => $st['business_name'], "address" => $st['business_address'], "phone" => $st['business_phone'],
                     "gstin" => $st['gstin'], "sac" => $st['sac_code']],
        "payments" => $payments, "payment_mode" => $mode, "voids" => [], "settled_by" => $user,
        "outlet_id" => current_outlet(),
        "commission" => is_aggregator($channel) ? money(($bill['subtotal'] - $bill['discount']) * floatval($st['aggregator_commission']) / 100) : 0,
    ]);
    $invoice = add_cost_snapshot($invoice);
    $invoices[] = $invoice;
    write_json("invoices.json", $invoices);

    $order = [
        "order_id" => "co_" . time() . rand(100, 999), "no" => next_doc_no("TA"), "channel" => $channel, "ref" => $ref !== '' ? $ref : $invoice['customer_name'],
        "customer_name" => $invoice['customer_name'], "customer_phone" => $phone, "address" => $address,
        "items" => $items, "status" => "Received", "timestamp" => $now, "invoice_id" => $invoice['invoice_id'],
        "invoice_no" => $invoice['invoice_no'], "total" => $invoice['total'], "outlet_id" => current_outlet(), "source" => $source,
    ];
    $cos = read_json("counter_orders.json", []);
    $cos[] = $order;
    if (count($cos) > 2000) $cos = array_slice($cos, -2000);
    write_json("counter_orders.json", $cos);
    if ($st['bom_enabled']) bom_deduct($items, "{$order['no']} ($channel)", $user);
    if (valid_indian_mobile($phone)) { customer_visit($phone, $invoice['customer_name']); customer_invoice($phone, $invoice['total']); }
    write_audit_log($user, "$channel order {$order['no']} " . ($ref !== '' ? "($ref) " : "") . "— {$invoice['invoice_no']}, ₹{$invoice['total']}, $mode");
    return [$order, $invoice];
}

function integration_auth() {
    $key = isset($_SERVER['HTTP_X_INTEGRATION_KEY']) ? (string)$_SERVER['HTTP_X_INTEGRATION_KEY'] : '';
    $saved = get_company_settings()['integration_key'];
    if ($saved === '' || $key === '' || !hash_equals($saved, $key)) {
        usleep(300000);
        erp_fail("Invalid integration key.", 401);
    }
}

// ─── P&L ────────────────────────────────────────────────────────────────────
function labour_cost($start, $end) {
    $staff = [];
    foreach (read_json("staff.json", []) as $s) $staff[$s['id']] = $s;
    $cost = 0; $hours = 0;
    foreach (read_json("attendance.json", []) as $a) {
        if (isset($a['outlet_id']) && $a['outlet_id'] !== current_outlet()) continue;
        $in = strtotime($a['in']);
        $out = !empty($a['out']) ? strtotime($a['out']) : time();
        $from = max($in, $start); $to = min($out, $end);
        if ($to <= $from || !isset($staff[$a['staff_id']])) continue;
        $h = ($to - $from) / 3600;
        $hours += $h;
        $cost += $h * floatval($staff[$a['staff_id']]['rate']);
    }
    return [money($cost), round($hours, 2)];
}

function compute_pnl($days) {
    $st = get_settings();
    $start = period_start($days);
    $end = time();
    $inv = period_invoices($days);
    $mats = inventory_index(); $bom = read_json("bom.json", []);
    $sales = 0; $sc = 0; $fc = 0; $comm = 0; $uncosted = 0; $by_ch = []; $top = [];
    foreach ($inv as $i) {
        $net = floatval($i['subtotal']) - floatval(isset($i['discount']) ? $i['discount'] : 0);
        $sales += $net;
        $sc += floatval($i['service_charge']);
        $comm += floatval(isset($i['commission']) ? $i['commission'] : 0);
        $ch = isset($i['channel']) ? $i['channel'] : 'Dine-in';
        $by_ch[$ch] = (isset($by_ch[$ch]) ? $by_ch[$ch] : 0) + $net;
        if (isset($i['food_cost'])) $fc += floatval($i['food_cost']);
        foreach ($i['items'] as $it) {
            if (!isset($i['food_cost'])) {
                $c = isset($it['id']) ? recipe_cost($it['id'], $it['variant'], $mats, $bom) : null;
                if ($c === null) $uncosted += $it['price'] * $it['quantity']; else $fc += $c * $it['quantity'];
            } elseif (!isset($it['unit_cost']) || $it['unit_cost'] === null) {
                $uncosted += $it['price'] * $it['quantity'];
            }
            $top[$it['name']] = (isset($top[$it['name']]) ? $top[$it['name']] : 0) + intval($it['quantity']);
        }
    }
    $waste = 0;
    foreach (read_json("wastage.json", []) as $w) {
        if ($w['status'] === 'Approved' && strtotime($w['timestamp']) >= $start && (isset($w['outlet_id']) ? $w['outlet_id'] : 'main') === current_outlet()) $waste += $w['value'];
    }
    $variance = 0;
    foreach (read_json("stock_variances.json", []) as $v) {
        if (strtotime($v['timestamp']) >= $start) $variance += $v['value'];
    }
    list($labour, $hours) = labour_cost($start, $end);
    arsort($top);
    $actual = $fc + $waste - $variance;   // negative variance (missing stock) raises actual food cost
    $contribution = $sales + $sc - $fc - $waste + $variance - $comm - $labour;
    $low = [];
    foreach ($mats as $m) if (floatval($m['stock']) <= floatval($m['reorder_level']) && floatval($m['reorder_level']) > 0) $low[] = $m['name'];
    $label = $days === 1 ? "Today" : "Last $days days";
    $topName = count($top) ? array_keys($top)[0] : '—';
    $wa = "*{$st['business_name']} · " . ($days === 1 ? date("d M Y") : $label) . "*\n"
        . "Sales: ₹" . number_format($sales, 0) . " + service ₹" . number_format($sc, 0) . " (" . count($inv) . " bills)\n"
        . "Food cost: " . ($sales ? number_format($fc / $sales * 100, 1) : '0') . "% theoretical, " . ($sales ? number_format($actual / $sales * 100, 1) : '0') . "% actual (target {$st['target_food_cost']}%)\n"
        . "Wastage: ₹" . number_format($waste, 0) . " · Count variance: ₹" . number_format($variance, 0) . "\n"
        . "Labour: ₹" . number_format($labour, 0) . " · Contribution: ₹" . number_format($contribution, 0) . "\n"
        . "Top seller: $topName\nLow stock: " . (count($low) ? implode(", ", array_slice($low, 0, 6)) : "none");
    return [
        "days" => $days, "label" => $label, "bills" => count($inv),
        "sales" => money($sales), "service_charge" => money($sc), "food_cost" => money($fc), "wastage" => money($waste),
        "variance" => money($variance), "commission" => money($comm), "labour" => $labour, "labour_hours" => $hours,
        "contribution" => money($contribution), "actual_food_cost" => money($actual),
        "theoretical_pct" => $sales ? round($fc / $sales * 100, 1) : 0, "actual_pct" => $sales ? round($actual / $sales * 100, 1) : 0,
        "labour_pct" => $sales ? round($labour / $sales * 100, 1) : 0,
        "target_food_cost" => floatval($st['target_food_cost']), "uncosted_sales" => money($uncosted),
        "by_channel" => $by_ch, "top_sellers" => array_slice($top, 0, 8, true),
        "whatsapp" => $wa, "owner_whatsapp" => $st['owner_whatsapp'],
    ];
}

// ─── Food safety ────────────────────────────────────────────────────────────
function temp_check($equipment, $value) {
    foreach (get_settings()['temp_limits'] as $l) {
        if ($l['name'] !== $equipment) continue;
        if (isset($l['max']) && $value > floatval($l['max'])) return false;
        if (isset($l['min']) && $value < floatval($l['min'])) return false;
        return true;
    }
    return null;   // unknown equipment
}

function log_temperature($equipment, $value, $source, $user) {
    $ok = temp_check($equipment, $value);
    if ($ok === null) erp_fail("Unknown equipment \"$equipment\". Add it under Food safety → limits.");
    $sf = read_json("safety.json", []);
    $sf['temps'] = isset($sf['temps']) ? $sf['temps'] : [];
    $sf['temps'][] = ["timestamp" => erp_now(), "equipment" => $equipment, "value" => round($value, 1), "ok" => $ok, "source" => $source, "by" => $user,
                      "outlet_id" => current_outlet()];
    if (count($sf['temps']) > 3000) $sf['temps'] = array_slice($sf['temps'], -3000);
    write_json("safety.json", $sf);
    if (!$ok) write_audit_log($user ?: "Sensor", "FOOD SAFETY ALERT: $equipment at {$value}°C is outside its limit ($source)");
    return $ok;
}

function default_licences() {
    return [["id" => "lic-fssai", "name" => "FSSAI licence", "expires_on" => ""], ["id" => "lic-excise", "name" => "Excise bar licence (L-10)", "expires_on" => ""],
            ["id" => "lic-fire", "name" => "Fire NOC", "expires_on" => ""], ["id" => "lic-trade", "name" => "Trade licence", "expires_on" => ""],
            ["id" => "lic-pest", "name" => "Pest-control contract", "expires_on" => ""]];
}

function safety_alerts() {
    $sf = read_json("safety.json", []);
    $n = 0;
    foreach (isset($sf['licences']) ? $sf['licences'] : [] as $l) {
        if (!empty($l['expires_on']) && (strtotime($l['expires_on']) - strtotime('today')) / 86400 <= 15) $n++;
    }
    $today = strtotime('today');
    foreach (isset($sf['temps']) ? $sf['temps'] : [] as $t) {
        if (!$t['ok'] && strtotime($t['timestamp']) >= $today && (isset($t['outlet_id']) ? $t['outlet_id'] : 'main') === current_outlet()) $n++;
    }
    return $n;
}

// ─── Router ─────────────────────────────────────────────────────────────────
function erp_handle($route, $method, $staff_user) {
    $ALL = ['Admin', 'Owner', 'Receptionist', 'Waiter', 'Kitchen'];
    $MGR = ['Admin', 'Owner'];
    $FLOOR = ['Admin', 'Owner', 'Receptionist'];
    $STOCK = ['Admin', 'Owner', 'Receptionist', 'Kitchen'];

    switch ($route) {

    // ── Rules (module settings editable without code) ──────────────────────
    case 'erp/rules':
        $keys = ["costing_basis", "target_food_cost", "expiry_alert_days", "waste_limit", "waste_reasons", "po_limit", "rate_variance_pct",
                 "qty_tolerance_pct", "max_discount_pct", "kds_warn_pct", "kds_stale_min", "block_bill_until_served", "stations",
                 "aggregator_markup", "aggregator_commission", "auto_accept_online", "owner_whatsapp", "temp_limits", "checklist_items"];
        if ($method === 'GET') {
            require_role($staff_user, $ALL);
            $s = get_settings();
            $out = array_intersect_key($s, array_flip($keys));
            if (get_user_role($staff_user) === 'Admin') $out['integration_key'] = customer_secret();   // created on first use
            echo json_encode($out);
            return true;
        }
        require_perm($staff_user, 'editSettings');
        $in = erp_input();
        $raw = read_json("settings.json", []);
        $changed = [];
        $num = function($k, $min, $max) use (&$in, &$raw, &$changed) {
            if (!isset($in[$k])) return;
            $v = max($min, min($max, round(floatval($in[$k]), 2)));
            $raw[$k] = $v; $changed[] = str_replace('_', ' ', $k) . " → $v";
        };
        $num('target_food_cost', 1, 100); $num('expiry_alert_days', 0, 60); $num('waste_limit', 0, 1000000);
        $num('po_limit', 0, 100000000); $num('rate_variance_pct', 0, 100); $num('qty_tolerance_pct', 0, 50);
        $num('max_discount_pct', 0, 100); $num('kds_warn_pct', 10, 100); $num('kds_stale_min', 1, 240);
        $num('aggregator_markup', 0, 100); $num('aggregator_commission', 0, 60);
        if (isset($in['costing_basis'])) { $raw['costing_basis'] = $in['costing_basis'] === 'last' ? 'last' : 'avg'; $changed[] = "costing basis → " . $raw['costing_basis']; }
        foreach (['block_bill_until_served', 'auto_accept_online'] as $b) if (isset($in[$b])) { $raw[$b] = (bool)$in[$b]; $changed[] = str_replace('_', ' ', $b) . " → " . ($raw[$b] ? 'on' : 'off'); }
        if (isset($in['owner_whatsapp'])) {
            $w = preg_replace('/\D/', '', (string)$in['owner_whatsapp']);
            if ($w !== '' && strlen($w) === 10) $w = '91' . $w;
            $raw['owner_whatsapp'] = substr($w, 0, 15); $changed[] = "owner WhatsApp updated";
        }
        foreach (['waste_reasons' => 30, 'stations' => 12, 'checklist_items' => 40] as $lk => $maxn) {
            if (isset($in[$lk]) && is_array($in[$lk])) {
                $vals = array_values(array_unique(array_filter(array_map(function($x) { return clean_text($x, 60); }, $in[$lk]))));
                if (count($vals) === 0) erp_fail("Keep at least one entry in " . str_replace('_', ' ', $lk) . ".");
                $raw[$lk] = array_slice($vals, 0, $maxn); $changed[] = str_replace('_', ' ', $lk) . " updated";
            }
        }
        if (isset($in['temp_limits']) && is_array($in['temp_limits'])) {
            $tl = [];
            foreach ($in['temp_limits'] as $t) {
                $n = clean_text(isset($t['name']) ? $t['name'] : '', 40);
                if ($n === '') continue;
                $row = ["name" => $n];
                if (isset($t['max']) && $t['max'] !== '' && $t['max'] !== null) $row['max'] = round(floatval($t['max']), 1);
                if (isset($t['min']) && $t['min'] !== '' && $t['min'] !== null) $row['min'] = round(floatval($t['min']), 1);
                if (!isset($row['max']) && !isset($row['min'])) erp_fail("Give \"$n\" a minimum or maximum temperature.");
                $tl[] = $row;
            }
            $raw['temp_limits'] = $tl; $changed[] = "temperature limits updated";
        }
        if (!empty($in['regenerate_integration_key'])) {
            require_role($staff_user, ['Admin']);
            $raw['integration_key'] = bin2hex(random_bytes(20)); $changed[] = "integration key regenerated";
        }
        write_json("settings.json", $raw);
        write_audit_log($staff_user, "Updated rules: " . (count($changed) ? implode("; ", $changed) : "no changes"));
        echo json_encode(["status" => "ok"]);
        return true;

    // ── Permissions & limits ───────────────────────────────────────────────
    case 'erp/permissions':
        if ($method === 'GET') {
            require_role($staff_user, $ALL);
            echo json_encode(["labels" => perm_labels(), "roles" => load_perms()]);
            return true;
        }
        require_role($staff_user, ['Admin']);
        $in = erp_input();
        $role = isset($in['role']) ? (string)$in['role'] : '';
        $perm = isset($in['perm']) ? (string)$in['perm'] : '';
        if (!isset(default_perms()[$role]) || !isset(perm_labels()[$perm])) erp_fail("Unknown role or permission.");
        $saved = read_json("permissions.json", []);
        $saved[$role][$perm] = (bool)(isset($in['value']) ? $in['value'] : false);
        write_json("permissions.json", $saved);
        write_audit_log($staff_user, "Permission \"" . perm_labels()[$perm] . "\" " . ($saved[$role][$perm] ? "granted to" : "removed from") . " $role");
        echo json_encode(["status" => "ok", "roles" => load_perms()]);
        return true;

    // ── Stock by location, counts, transfers, expiry ───────────────────────
    case 'erp/stock':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, $STOCK);
            $st = get_settings();
            $mats = [];
            $soon = strtotime("+" . intval($st['expiry_alert_days']) . " days", strtotime('today'));
            $value = 0;
            foreach (read_json("inventory.json", ["materials" => []])['materials'] as $m) {
                $m['kitchen'] = kitchen_qty($m);
                $m['store'] = store_qty($m);
                $m['rate'] = money(material_rate($m));
                $m['low'] = floatval($m['stock']) <= floatval($m['reorder_level']);
                $m['expiring'] = !empty($m['expires_on']) && strtotime($m['expires_on']) <= $soon;
                $m['expired'] = !empty($m['expires_on']) && strtotime($m['expires_on']) < strtotime('today');
                $value += max(0, floatval($m['stock'])) * $m['rate'];
                $mats[] = $m;
            }
            $var = read_json("stock_variances.json", []);
            $today = strtotime('today');
            echo json_encode([
                "materials" => $mats, "stock_value" => money($value),
                "transfers" => array_slice(array_reverse(read_json("transfers.json", [])), 0, 40),
                "variances" => array_slice(array_reverse($var), 0, 60),
                "variance_today" => money(array_sum(array_map(function($v) use ($today) { return strtotime($v['timestamp']) >= $today ? $v['value'] : 0; }, $var))),
                "expiry_alert_days" => $st['expiry_alert_days'], "categories" => material_categories(),
            ]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        require_perm($staff_user, 'stockCount');
        $inv = read_json("inventory.json", ["materials" => []]);
        if ($action === 'issue') {
            // Main store → kitchen / bar (or back)
            $mid = (string)(isset($in['material_id']) ? $in['material_id'] : '');
            $q = round(floatval(isset($in['qty']) ? $in['qty'] : 0), 3);
            $back = isset($in['direction']) && $in['direction'] === 'return';
            if ($q <= 0) erp_fail("Enter a quantity.");
            $done = null;
            foreach ($inv['materials'] as &$m) {
                if ($m['id'] !== $mid) continue;
                $k = kitchen_qty($m); $s = store_qty($m);
                if (!$back && $q > $s + 0.0005) erp_fail("Only " . $s . " " . $m['unit'] . " is in the main store.");
                if ($back && $q > $k + 0.0005) erp_fail("Only " . $k . " " . $m['unit'] . " is in the kitchen.");
                $m['kitchen_stock'] = round($back ? $k - $q : $k + $q, 3);
                $done = $m;
            }
            unset($m);
            if (!$done) erp_fail("Material not found.", 404);
            write_json("inventory.json", $inv);
            $no = next_doc_no("TRF");
            $tr = read_json("transfers.json", []);
            $tr[] = ["no" => $no, "timestamp" => erp_now(), "material_id" => $mid, "name" => $done['name'], "unit" => $done['unit'], "qty" => $q,
                     "from" => $back ? "Kitchen / bar" : "Main store", "to" => $back ? "Main store" : "Kitchen / bar", "by" => $staff_user];
            write_json("transfers.json", array_slice($tr, -2000));
            write_audit_log($staff_user, "$no: $q {$done['unit']} {$done['name']} " . ($back ? "returned to main store" : "issued to kitchen / bar"));
            echo json_encode(["status" => "ok", "no" => $no]);
        } elseif ($action === 'count') {
            // Physical count: the difference to the system figure posts as variance
            $counts = isset($in['counts']) && is_array($in['counts']) ? $in['counts'] : [];
            $byId = [];
            foreach ($counts as $c) {
                if (!isset($c['material_id']) || !isset($c['counted']) || $c['counted'] === '' || $c['counted'] === null) continue;
                $byId[(string)$c['material_id']] = max(0, round(floatval($c['counted']), 3));
            }
            if (!count($byId)) erp_fail("Enter at least one counted quantity.");
            $var = read_json("stock_variances.json", []);
            $ledger = [];
            $no = next_doc_no("CNT");
            $total = 0;
            foreach ($inv['materials'] as &$m) {
                if (!isset($byId[$m['id']])) continue;
                $sys = round(floatval($m['stock']), 3);
                $diff = round($byId[$m['id']] - $sys, 3);
                $val = money($diff * material_rate($m));
                $total += $val;
                $m['stock'] = $byId[$m['id']];
                $m['kitchen_stock'] = round(max(0, min(kitchen_qty($m) + min(0, $diff), $m['stock'])), 3);
                $var[] = ["no" => $no, "timestamp" => erp_now(), "material_id" => $m['id'], "name" => $m['name'], "unit" => $m['unit'],
                          "system" => $sys, "counted" => $byId[$m['id']], "diff" => $diff, "value" => $val, "by" => $staff_user];
                if (abs($diff) > 0.0005) $ledger[] = ["timestamp" => erp_now(), "material_id" => $m['id'], "name" => $m['name'], "delta" => $diff,
                                                     "balance" => $m['stock'], "reason" => "Stock count $no", "user" => $staff_user];
            }
            unset($m);
            write_json("inventory.json", $inv);
            write_json("stock_variances.json", array_slice($var, -5000));
            add_ledger_entries($ledger);
            write_audit_log($staff_user, "Posted stock count $no for " . count($byId) . " material(s); variance ₹" . money($total));
            echo json_encode(["status" => "ok", "no" => $no, "variance" => money($total)]);
        } else {
            erp_fail("Unknown stock action.");
        }
        return true;

    // ── Wastage ────────────────────────────────────────────────────────────
    case 'erp/wastage':
        require_bom_enabled();
        $st = get_settings();
        if ($method === 'GET') {
            require_role($staff_user, $STOCK);
            $w = read_json("wastage.json", []);
            $days = period_days(1);
            $start = period_start($days);
            $by = []; $tot = 0;
            foreach ($w as $x) {
                if ($x['status'] !== 'Approved' || strtotime($x['timestamp']) < $start) continue;
                $by[$x['reason']] = (isset($by[$x['reason']]) ? $by[$x['reason']] : 0) + $x['value'];
                $tot += $x['value'];
            }
            arsort($by);
            $sales = array_sum(array_map(function($i) { return $i['subtotal'] - (isset($i['discount']) ? $i['discount'] : 0); }, period_invoices($days)));
            echo json_encode(["entries" => array_slice(array_reverse($w), 0, 200), "by_reason" => $by, "total" => money($tot),
                              "pct_of_sales" => $sales ? round($tot / $sales * 100, 1) : 0, "reasons" => $st['waste_reasons'],
                              "limit" => $st['waste_limit'], "reuse" => array_slice(array_reverse(read_json("reuse.json", [])), 0, 50),
                              "pending" => count(array_filter($w, function($x) { return $x['status'] === 'Pending approval'; }))]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        $w = read_json("wastage.json", []);
        $mats = inventory_index();
        if ($action === 'log' || $action === 'reuse') {
            require_role($staff_user, $STOCK);
            $mid = (string)(isset($in['material_id']) ? $in['material_id'] : '');
            $q = round(floatval(isset($in['qty']) ? $in['qty'] : 0), 3);
            if (!isset($mats[$mid])) erp_fail("Choose a material.");
            if ($q <= 0) erp_fail("Enter a quantity.");
            $m = $mats[$mid];
            $val = money($q * material_rate($m));
            if ($action === 'reuse') {
                // Leftovers reused (staff meal, soup…): leaves stock, not counted as waste
                $to = clean_text(isset($in['used_for']) ? $in['used_for'] : '', 40);
                if ($to === '') erp_fail("Say what it was reused for.");
                bom_adjust_stock($mid, -$q, "Reused as $to", $staff_user);
                $r = read_json("reuse.json", []);
                $r[] = ["timestamp" => erp_now(), "material_id" => $mid, "name" => $m['name'], "unit" => $m['unit'], "qty" => $q, "used_for" => $to, "value" => $val, "by" => $staff_user];
                write_json("reuse.json", array_slice($r, -2000));
                write_audit_log($staff_user, "Reused $q {$m['unit']} {$m['name']} as $to (₹$val recovered)");
                echo json_encode(["status" => "ok"]);
                return true;
            }
            $reason = clean_text(isset($in['reason']) ? $in['reason'] : '', 60);
            if (!in_array($reason, $st['waste_reasons'], true)) erp_fail("Choose a reason from the list.");
            $pending = $val > floatval($st['waste_limit']) && !has_perm($staff_user, 'approveWaste');
            $no = next_doc_no("WST");
            $w[] = ["no" => $no, "timestamp" => erp_now(), "material_id" => $mid, "name" => $m['name'], "unit" => $m['unit'], "qty" => $q,
                    "reason" => $reason, "note" => clean_text(isset($in['note']) ? $in['note'] : '', 120), "value" => $val,
                    "status" => $pending ? "Pending approval" : "Approved", "by" => $staff_user, "outlet_id" => current_outlet()];
            write_json("wastage.json", array_slice($w, -5000));
            if (!$pending) bom_adjust_stock($mid, -$q, "Wastage $no — $reason", $staff_user);
            write_audit_log($staff_user, "$no: $q {$m['unit']} {$m['name']} ₹$val ($reason) " . ($pending ? "sent for approval" : "written off"));
            echo json_encode(["status" => "ok", "no" => $no, "pending" => $pending]);
        } elseif ($action === 'approve' || $action === 'reject') {
            require_perm($staff_user, 'approveWaste');
            $no = (string)(isset($in['no']) ? $in['no'] : '');
            $hit = null;
            foreach ($w as &$x) if ($x['no'] === $no && $x['status'] === 'Pending approval') { $x['status'] = $action === 'approve' ? 'Approved' : 'Rejected'; $x['approved_by'] = $staff_user; $hit = $x; }
            unset($x);
            if (!$hit) erp_fail("That entry is not waiting for approval.", 404);
            write_json("wastage.json", $w);
            if ($action === 'approve') bom_adjust_stock($hit['material_id'], -$hit['qty'], "Wastage $no — {$hit['reason']}", $staff_user);
            write_audit_log($staff_user, ($action === 'approve' ? "Approved" : "Rejected") . " wastage $no (₹{$hit['value']})");
            echo json_encode(["status" => "ok"]);
        } else {
            erp_fail("Unknown wastage action.");
        }
        return true;

    // ── Production, labels, dispatch, prep list ────────────────────────────
    case 'erp/production':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, $STOCK);
            $mats = inventory_index();
            $recipes = read_json("production_recipes.json", []);
            $out = [];
            foreach ($mats as $m) {
                if ((isset($m['category']) ? $m['category'] : '') !== 'Semi-finished') continue;
                $r = isset($recipes[$m['id']]) ? $recipes[$m['id']] : [];
                list($cost, $lines) = recipe_cost_lines($r, $mats);
                $out[] = ["material" => $m, "ingredients" => $lines, "cost_per_unit" => $cost];
            }
            // Tomorrow's prep: average daily portions over the last 7 days × 1.2, by station
            $sold = [];
            foreach (period_invoices(7) as $i) foreach ($i['items'] as $it) {
                $k = $it['name'] . '||' . $it['variant'];
                if (!isset($sold[$k])) $sold[$k] = ["name" => $it['name'], "variant" => $it['variant'], "qty" => 0, "station" => menu_meta(isset($it['id']) ? $it['id'] : '')['station']];
                $sold[$k]['qty'] += $it['quantity'];
            }
            $prep = [];
            foreach ($sold as $s) if ($s['station'] !== 'Bar') $prep[] = ["station" => $s['station'], "name" => $s['name'], "variant" => $s['variant'], "portions" => (int)ceil($s['qty'] / 7 * 1.2)];
            usort($prep, function($a, $b) { return strcmp($a['station'], $b['station']) ?: $b['portions'] - $a['portions']; });
            echo json_encode(["semi" => $out, "batches" => array_slice(array_reverse(read_json("batches.json", [])), 0, 60),
                              "dispatches" => array_slice(array_reverse(read_json("dispatches.json", [])), 0, 60), "prep" => $prep,
                              "outlets" => array_map(function($o) { return ["id" => $o['id'], "name" => $o['name']]; }, load_outlets()),
                              "current_outlet" => current_outlet(), "tolerance" => get_settings()['qty_tolerance_pct']]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        $mats = inventory_index();
        if ($action === 'recipe') {
            require_perm($staff_user, 'editRecipe');
            $mid = (string)(isset($in['material_id']) ? $in['material_id'] : '');
            if (!isset($mats[$mid]) || $mats[$mid]['category'] !== 'Semi-finished') erp_fail("Choose a semi-finished material.");
            $ings = [];
            foreach ((isset($in['ingredients']) && is_array($in['ingredients']) ? $in['ingredients'] : []) as $g) {
                $gid = (string)(isset($g['material_id']) ? $g['material_id'] : '');
                $q = round(floatval(isset($g['qty']) ? $g['qty'] : 0), 4);
                if ($gid === $mid || !isset($mats[$gid]) || $q <= 0) continue;
                $ings[] = ["material_id" => $gid, "qty" => $q, "loss_pct" => max(0, min(90, round(floatval(isset($g['loss_pct']) ? $g['loss_pct'] : 0), 2)))];
            }
            $r = read_json("production_recipes.json", []);
            $r[$mid] = $ings;
            write_json("production_recipes.json", (object)$r);
            write_audit_log($staff_user, "Updated production recipe for {$mats[$mid]['name']} (" . count($ings) . " ingredients per 1 {$mats[$mid]['unit']})");
            echo json_encode(["status" => "ok"]);
        } elseif ($action === 'produce') {
            require_role($staff_user, $STOCK);
            $mid = (string)(isset($in['material_id']) ? $in['material_id'] : '');
            $planned = round(floatval(isset($in['planned']) ? $in['planned'] : 0), 3);
            $actual = round(floatval(isset($in['actual']) ? $in['actual'] : 0), 3);
            $r = read_json("production_recipes.json", []);
            if (!isset($mats[$mid]) || empty($r[$mid])) erp_fail("Set up the recipe for this item first.");
            if ($planned <= 0 || $actual <= 0) erp_fail("Enter the planned and actual quantities.");
            $need = []; $cost = 0;
            foreach ($r[$mid] as $g) {
                $q = $g['qty'] * (1 + $g['loss_pct'] / 100) * $planned;
                $need[$g['material_id']] = $q;
                $cost += $q * material_rate($mats[$g['material_id']]);
                if (floatval($mats[$g['material_id']]['stock']) + 0.0005 < $q) erp_fail("Not enough {$mats[$g['material_id']]['name']}: needs " . round($q, 3) . " {$mats[$g['material_id']]['unit']}.");
            }
            $no = next_doc_no("BAT");
            foreach ($need as $gid => $q) bom_adjust_stock($gid, -$q, "Used in batch $no", $staff_user);
            // Output: weighted-average cost of the semi-finished item, into the kitchen
            $inv = read_json("inventory.json", ["materials" => []]);
            $out = null;
            foreach ($inv['materials'] as &$m) {
                if ($m['id'] !== $mid) continue;
                $old = max(0, floatval($m['stock']));
                $m['cost_per_unit'] = money(($old * floatval($m['cost_per_unit']) + $cost) / ($old + $actual));
                $m['last_cost'] = money($cost / $actual);
                $m['stock'] = round(floatval($m['stock']) + $actual, 3);
                $m['kitchen_stock'] = round(kitchen_qty($m) + $actual, 3);
                if (!empty($m['shelf_life_days'])) $m['expires_on'] = date("Y-m-d", strtotime("+" . intval($m['shelf_life_days']) . " days"));
                $out = $m;
            }
            unset($m);
            write_json("inventory.json", $inv);
            add_ledger_entries([["timestamp" => erp_now(), "material_id" => $mid, "name" => $out['name'], "delta" => $actual, "balance" => $out['stock'],
                                 "reason" => "Produced in batch $no", "user" => $staff_user]]);
            $b = read_json("batches.json", []);
            $batch = ["no" => $no, "timestamp" => erp_now(), "material_id" => $mid, "name" => $out['name'], "unit" => $out['unit'],
                      "planned" => $planned, "actual" => $actual, "yield_pct" => round($actual / $planned * 100, 1), "cost" => money($cost),
                      "cost_per_unit" => money($cost / $actual), "use_by" => !empty($out['shelf_life_days']) ? $out['expires_on'] : '', "by" => $staff_user];
            $b[] = $batch;
            write_json("batches.json", array_slice($b, -3000));
            write_audit_log($staff_user, "Batch $no: produced $actual {$out['unit']} {$out['name']} (planned $planned, yield {$batch['yield_pct']}%)");
            echo json_encode(["status" => "ok", "batch" => $batch]);
        } elseif ($action === 'dispatch') {
            require_perm($staff_user, 'stockCount');
            $mid = (string)(isset($in['material_id']) ? $in['material_id'] : '');
            $q = round(floatval(isset($in['qty']) ? $in['qty'] : 0), 3);
            $to = outlet_by_id((string)(isset($in['outlet_id']) ? $in['outlet_id'] : ''));
            if (!isset($mats[$mid]) || $q <= 0) erp_fail("Choose a material and quantity.");
            if (!$to || $to['id'] === current_outlet()) erp_fail("Choose another outlet to send to.");
            if (floatval($mats[$mid]['stock']) + 0.0005 < $q) erp_fail("Only " . $mats[$mid]['stock'] . " {$mats[$mid]['unit']} available.");
            $no = next_doc_no("DC");
            bom_adjust_stock($mid, -$q, "Dispatched on challan $no to {$to['name']}", $staff_user);
            $d = read_json("dispatches.json", []);
            $d[] = ["no" => $no, "timestamp" => erp_now(), "material_id" => $mid, "name" => $mats[$mid]['name'], "unit" => $mats[$mid]['unit'], "qty" => $q,
                    "value" => money($q * material_rate($mats[$mid])), "from" => current_outlet(), "to" => $to['id'], "to_name" => $to['name'],
                    "status" => "In transit", "by" => $staff_user];
            write_json("dispatches.json", array_slice($d, -3000));
            write_audit_log($staff_user, "Delivery challan $no: $q {$mats[$mid]['unit']} {$mats[$mid]['name']} to {$to['name']}");
            echo json_encode(["status" => "ok", "no" => $no]);
        } elseif ($action === 'receive_dispatch') {
            require_role($staff_user, $STOCK);
            $no = (string)(isset($in['no']) ? $in['no'] : '');
            $d = read_json("dispatches.json", []);
            $hit = null;
            foreach ($d as &$x) if ($x['no'] === $no && $x['status'] === 'In transit') { $x['status'] = 'Received'; $x['received_at'] = erp_now(); $x['received_by'] = $staff_user; $hit = $x; }
            unset($x);
            if (!$hit) erp_fail("Challan not found or already received.", 404);
            write_json("dispatches.json", $d);
            write_audit_log($staff_user, "Challan $no received at {$hit['to_name']}");
            echo json_encode(["status" => "ok"]);
        } else {
            erp_fail("Unknown production action.");
        }
        return true;

    // ── Recipe costing & menu engineering ──────────────────────────────────
    case 'erp/costing':
        require_bom_enabled();
        require_role($staff_user, $STOCK);
        $days = period_days(30);
        $mats = inventory_index();
        $bom = read_json("bom.json", []);
        $sold = [];
        foreach (period_invoices($days) as $i) foreach ($i['items'] as $it) {
            $k = (isset($it['id']) ? $it['id'] : '') . '||' . $it['variant'];
            $sold[$k] = (isset($sold[$k]) ? $sold[$k] : 0) + $it['quantity'];
        }
        $rows = [];
        foreach (menu_index()['items'] as $item) {
            foreach (isset($item['price_variants']) ? $item['price_variants'] : [] as $v) {
                $has = isset($bom[$item['id']][$v['label']]);
                list($cost, $lines) = $has ? recipe_cost_lines($bom[$item['id']][$v['label']], $mats) : [null, []];
                $rows[] = ["item_id" => $item['id'], "name" => $item['name'], "variant" => $v['label'], "price" => floatval($v['price']),
                           "cost" => $cost, "lines" => $lines, "food_cost_pct" => $cost !== null && $v['price'] > 0 ? round($cost / $v['price'] * 100, 1) : null,
                           "margin" => $cost !== null ? money($v['price'] - $cost) : null, "sold" => isset($sold[$item['id'] . '||' . $v['label']]) ? $sold[$item['id'] . '||' . $v['label']] : 0];
            }
        }
        // Menu engineering (only items that have a recipe): popularity vs margin
        $costed = array_values(array_filter($rows, function($r) { return $r['cost'] !== null; }));
        $n = count($costed);
        $avgSold = $n ? array_sum(array_column($costed, 'sold')) / $n : 0;
        $avgMargin = $n ? array_sum(array_column($costed, 'margin')) / $n : 0;
        foreach ($rows as &$r) {
            if ($r['cost'] === null) { $r['class'] = null; continue; }
            $pop = $r['sold'] >= $avgSold && $r['sold'] > 0;
            $r['class'] = $pop ? ($r['margin'] >= $avgMargin ? 'Star' : 'Plowhorse') : ($r['margin'] >= $avgMargin ? 'Puzzle' : 'Dog');
        }
        unset($r);
        echo json_encode(["rows" => $rows, "days" => $days, "basis" => get_settings()['costing_basis'], "target" => get_settings()['target_food_cost']]);
        return true;

    // ── Vendor scorecard ───────────────────────────────────────────────────
    case 'erp/vendors':
        require_bom_enabled();
        require_role($staff_user, $FLOOR);
        $card = [];
        foreach (read_json("suppliers.json", []) as $sp) $card[$sp['id']] = ["supplier" => $sp['name'], "pos" => 0, "receipts" => 0, "lines" => 0, "rejected" => 0, "rate_alerts" => 0, "on_time" => 0, "value" => 0];
        foreach (read_json("purchase_orders.json", []) as $po) {
            if (!isset($card[$po['supplier_id']])) continue;
            $c = &$card[$po['supplier_id']];
            if (!in_array($po['status'], ['Draft', 'Rejected'], true)) $c['pos']++;
            foreach (isset($po['receipts']) ? $po['receipts'] : [] as $r) {
                $c['receipts']++;
                $c['lines'] += count($r['lines']) + count(isset($r['rejected']) ? $r['rejected'] : []);
                $c['rejected'] += count(isset($r['rejected']) ? $r['rejected'] : []);
                $c['rate_alerts'] += count(isset($r['rate_alerts']) ? $r['rate_alerts'] : []);
                if (!isset($r['on_time']) || $r['on_time']) $c['on_time']++;
                $c['value'] += $r['value'];
            }
            unset($c);
        }
        foreach ($card as &$c) {
            $c['on_time_pct'] = $c['receipts'] ? round($c['on_time'] / $c['receipts'] * 100) : null;
            $c['reject_pct'] = $c['lines'] ? round($c['rejected'] / $c['lines'] * 100) : null;
        }
        unset($c);
        echo json_encode(array_values($card));
        return true;

    // ── Kitchen stations config (station + target per menu item) ───────────
    case 'erp/stations':
        if ($method === 'GET') {
            require_role($staff_user, $ALL);
            $out = [];
            foreach (menu_index()['items'] as $it) {
                $m = menu_meta($it['id']);
                $out[] = ["id" => $it['id'], "name" => $it['name'], "station" => $m['station'], "target_min" => $m['target_min'],
                          "brand" => $m['brand'], "online" => $m['online'], "alcoholic" => $m['alcoholic']];
            }
            echo json_encode(["items" => $out, "stations" => get_settings()['stations']]);
            return true;
        }
        require_perm($staff_user, 'editSettings');
        $in = erp_input();
        $md = read_json("menu_data.json", ["categories" => [], "items" => []]);
        $stations = get_settings()['stations'];
        $upd = [];
        foreach ((isset($in['items']) && is_array($in['items']) ? $in['items'] : []) as $u) $upd[(string)$u['id']] = $u;
        $n = 0;
        foreach ($md['items'] as &$it) {
            if (!isset($upd[$it['id']])) continue;
            $u = $upd[$it['id']];
            if (isset($u['station']) && in_array($u['station'], $stations, true)) $it['station'] = $u['station'];
            if (isset($u['target_min'])) $it['target_min'] = max(1, min(180, intval($u['target_min'])));
            if (isset($u['brand'])) $it['brand'] = clean_text($u['brand'], 40);
            if (isset($u['online'])) $it['online'] = (bool)$u['online'];
            $n++;
        }
        unset($it);
        write_json("menu_data.json", $md);
        write_audit_log($staff_user, "Updated station / target / channel settings for $n menu item(s)");
        echo json_encode(["status" => "ok"]);
        return true;

    // ── Takeaway, delivery and online orders ───────────────────────────────
    case 'erp/counter':
        if ($method === 'GET') {
            require_role($staff_user, $FLOOR);
            $st = get_settings();
            $today = strtotime('today');
            $cos = array_values(array_filter(read_json("counter_orders.json", []), function($c) use ($today) {
                return (isset($c['outlet_id']) ? $c['outlet_id'] : 'main') === current_outlet() && strtotime($c['timestamp']) >= $today;
            }));
            foreach ($cos as &$c) $c['customer_phone'] = show_phone($c['customer_phone'], $staff_user);
            unset($c);
            $set = []; $brands = [];
            foreach (period_invoices(1) as $i) {
                $ch = isset($i['channel']) ? $i['channel'] : 'Dine-in';
                if (!isset($set[$ch])) $set[$ch] = ["channel" => $ch, "orders" => 0, "sales" => 0, "commission" => 0];
                $set[$ch]['orders']++;
                $set[$ch]['sales'] += $i['total'];
                $set[$ch]['commission'] += isset($i['commission']) ? $i['commission'] : 0;
                foreach ($i['items'] as $it) {
                    $b = menu_meta(isset($it['id']) ? $it['id'] : '')['brand'];
                    $brands[$b] = (isset($brands[$b]) ? $brands[$b] : 0) + $it['price'] * $it['quantity'];
                }
            }
            foreach ($set as &$x) { $x['sales'] = money($x['sales']); $x['commission'] = money($x['commission']); $x['payout'] = money($x['sales'] - $x['commission']); }
            unset($x);
            $menu = [];
            foreach (menu_index()['items'] as $it) {
                if ($it['status'] !== 'Published') continue;
                $m = menu_meta($it['id']);
                $menu[] = ["id" => $it['id'], "name" => $it['name'], "available" => $it['availability'] === 'Available', "variants" => $it['price_variants'],
                           "alcoholic" => $m['alcoholic'], "online" => $m['online'], "brand" => $m['brand'], "station" => $m['station']];
            }
            echo json_encode(["orders" => array_reverse($cos), "incoming" => read_json("incoming_orders.json", []), "settlement" => array_values($set),
                              "brands" => $brands, "menu" => $menu, "markup" => $st['aggregator_markup'], "commission" => $st['aggregator_commission'],
                              "auto_accept" => $st['auto_accept_online'], "payment_methods" => enabled_payment_methods()]);
            return true;
        }
        require_role($staff_user, $FLOOR);
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        if ($action === 'order') {
            $ch = (string)(isset($in['channel']) ? $in['channel'] : '');
            $name = clean_text(isset($in['customer_name']) ? $in['customer_name'] : '', 40);
            $phone = clean_phone(isset($in['customer_phone']) ? $in['customer_phone'] : '');
            if ($phone !== '' && !valid_indian_mobile($phone)) erp_fail("Enter a valid 10-digit mobile number, or leave it blank.");
            if ($ch === 'Delivery' && clean_text(isset($in['address']) ? $in['address'] : '', 200) === '') erp_fail("Enter the delivery address.");
            if (is_aggregator($ch) && clean_text(isset($in['ref']) ? $in['ref'] : '', 30) === '') erp_fail("Enter the $ch order ID.");
            list($order, $invoice) = create_counter_order($ch, $name, $phone, clean_text(isset($in['ref']) ? $in['ref'] : '', 30),
                clean_text(isset($in['address']) ? $in['address'] : '', 200), isset($in['items']) ? $in['items'] : [], isset($in['payments']) ? $in['payments'] : [], $staff_user, "Counter");
            echo json_encode(["status" => "ok", "order" => $order, "invoice" => $invoice]);
        } elseif ($action === 'accept' || $action === 'reject') {
            $id = (string)(isset($in['id']) ? $in['id'] : '');
            $q = read_json("incoming_orders.json", []);
            $hit = null; $rest = [];
            foreach ($q as $o) { if ($o['id'] === $id) $hit = $o; else $rest[] = $o; }
            if (!$hit) erp_fail("That online order is no longer waiting.", 404);
            if ($action === 'accept') {
                list($order, $invoice) = create_counter_order($hit['platform'], $hit['customer_name'], '', $hit['ref'], '', $hit['items'], [], $staff_user, "Accepted from queue");
            } else {
                write_audit_log($staff_user, "Rejected {$hit['platform']} order {$hit['ref']}");
            }
            write_json("incoming_orders.json", $rest);
            echo json_encode(["status" => "ok"]);
        } else {
            erp_fail("Unknown order action.");
        }
        return true;

    // Webhook for aggregator middleware (e.g. UrbanPiper) — header X-Integration-Key
    case 'integrations/aggregator':
        if ($method !== 'POST') return false;
        integration_auth();
        $in = erp_input();
        $platform = (string)(isset($in['platform']) ? $in['platform'] : '');
        if (!is_aggregator($platform)) erp_fail("platform must be Swiggy or Zomato.");
        $ref = clean_text(isset($in['order_id']) ? $in['order_id'] : '', 30);
        if ($ref === '') erp_fail("order_id is required.");
        foreach (read_json("counter_orders.json", []) as $c) if ($c['ref'] === $ref && $c['channel'] === $platform) { echo json_encode(["status" => "ok", "duplicate" => true]); return true; }
        $items = isset($in['items']) && is_array($in['items']) ? $in['items'] : [];
        $name = clean_text(isset($in['customer_name']) ? $in['customer_name'] : '', 40);
        if (get_settings()['auto_accept_online']) {
            list($order, $invoice) = create_counter_order($platform, $name, '', $ref, '', $items, [], "Integration", "Webhook (auto-accepted)");
            echo json_encode(["status" => "ok", "accepted" => true, "order_no" => $order['no'], "invoice_no" => $invoice['invoice_no']]);
        } else {
            $q = read_json("incoming_orders.json", []);
            $q[] = ["id" => "in_" . time() . rand(100, 999), "platform" => $platform, "ref" => $ref, "customer_name" => $name, "items" => $items, "received_at" => erp_now()];
            write_json("incoming_orders.json", $q);
            write_audit_log("Integration", "$platform order $ref waiting for acceptance");
            echo json_encode(["status" => "ok", "accepted" => false, "queued" => true]);
        }
        return true;

    // ── P&L & food cost ────────────────────────────────────────────────────
    case 'erp/pnl':
        require_role($staff_user, $MGR);
        echo json_encode(compute_pnl(period_days(1)));
        return true;

    // ── Staff & shifts ─────────────────────────────────────────────────────
    case 'erp/staff':
        $date = isset($_GET['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date']) ? $_GET['date'] : date("Y-m-d");
        if ($method === 'GET') {
            require_role($staff_user, $FLOOR);
            $staff = read_json("staff.json", []);
            $roster = read_json("roster.json", []);
            $att = read_json("attendance.json", []);
            $dayStart = strtotime($date); $dayEnd = $dayStart + 86400;
            foreach ($staff as &$s) {
                $s['shift'] = isset($roster[$date][$s['id']]) ? $roster[$date][$s['id']] : 'Off';
                $s['clocked_in'] = false; $s['hours'] = 0;
                foreach ($att as $a) {
                    if ($a['staff_id'] !== $s['id']) continue;
                    if (empty($a['out'])) $s['clocked_in'] = true;
                    $from = max(strtotime($a['in']), $dayStart); $to = min(!empty($a['out']) ? strtotime($a['out']) : time(), $dayEnd);
                    if ($to > $from) $s['hours'] += ($to - $from) / 3600;
                }
                $s['hours'] = round($s['hours'], 2);
                $s['cost'] = money($s['hours'] * $s['rate']);
            }
            unset($s);
            list($labour) = labour_cost($dayStart, min($dayEnd, time()));
            $sales = $date === date("Y-m-d") ? array_sum(array_map(function($i) { return $i['subtotal'] - (isset($i['discount']) ? $i['discount'] : 0); }, period_invoices(1))) : 0;
            echo json_encode(["date" => $date, "staff" => $staff, "labour" => $labour, "sales" => money($sales), "labour_pct" => $sales ? round($labour / $sales * 100, 1) : 0,
                              "attendance" => array_slice(array_reverse(array_values(array_filter($att, function($a) use ($dayStart, $dayEnd) {
                                  return strtotime($a['in']) < $dayEnd && (empty($a['out']) || strtotime($a['out']) >= $dayStart); }))), 0, 100)]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        $staff = read_json("staff.json", []);
        if ($action === 'save' || $action === 'delete') {
            require_role($staff_user, $MGR);
            $id = (string)(isset($in['id']) ? $in['id'] : '');
            if ($action === 'delete') {
                $staff = array_values(array_filter($staff, function($s) use ($id) { return $s['id'] !== $id; }));
                write_json("staff.json", $staff);
                write_audit_log($staff_user, "Removed staff member $id");
                echo json_encode(["status" => "ok"]);
                return true;
            }
            $name = clean_text(isset($in['name']) ? $in['name'] : '', 50);
            if ($name === '') erp_fail("Enter the staff member's name.");
            $row = ["name" => $name, "title" => clean_text(isset($in['title']) ? $in['title'] : '', 40), "rate" => max(0, money(isset($in['rate']) ? $in['rate'] : 0)),
                    "username" => strtolower(clean_text(isset($in['username']) ? $in['username'] : '', 32)), "device_id" => clean_text(isset($in['device_id']) ? $in['device_id'] : '', 30)];
            $found = false;
            foreach ($staff as &$s) if ($id !== '' && $s['id'] === $id) { $s = array_merge($s, $row); $found = true; }
            unset($s);
            if (!$found) { $id = "stf-" . time() . "-" . bin2hex(random_bytes(2)); $staff[] = array_merge(["id" => $id], $row); }
            write_json("staff.json", $staff);
            write_audit_log($staff_user, ($found ? "Updated" : "Added") . " staff member $name");
            echo json_encode(["status" => "ok", "id" => $id]);
        } elseif ($action === 'shift') {
            require_role($staff_user, $FLOOR);
            $sid = (string)(isset($in['staff_id']) ? $in['staff_id'] : '');
            $shift = in_array(isset($in['shift']) ? $in['shift'] : '', ['Morning', 'Evening', 'Full day', 'Off'], true) ? $in['shift'] : 'Off';
            $r = read_json("roster.json", []);
            $r[$date][$sid] = $shift;
            write_json("roster.json", $r);
            echo json_encode(["status" => "ok"]);
        } elseif ($action === 'clock') {
            require_role($staff_user, $FLOOR);
            $sid = (string)(isset($in['staff_id']) ? $in['staff_id'] : '');
            echo json_encode(clock_staff($sid, "Manual · $staff_user", $staff_user));
        } else {
            erp_fail("Unknown staff action.");
        }
        return true;

    // Webhook for biometric / attendance devices — {staff_id | device_id, type: in|out}
    case 'integrations/attendance':
        if ($method !== 'POST') return false;
        integration_auth();
        $in = erp_input();
        $sid = (string)(isset($in['staff_id']) ? $in['staff_id'] : '');
        if ($sid === '' && !empty($in['device_id'])) foreach (read_json("staff.json", []) as $s) if ($s['device_id'] === (string)$in['device_id']) $sid = $s['id'];
        echo json_encode(clock_staff($sid, "Biometric device", "Device", isset($in['type']) ? $in['type'] : null));
        return true;

    // ── Food safety ────────────────────────────────────────────────────────
    case 'erp/safety':
        if ($method === 'GET') {
            require_role($staff_user, $STOCK);
            $sf = read_json("safety.json", []);
            $today = date("Y-m-d");
            $items = get_settings()['checklist_items'];
            $done = isset($sf['checklist'][current_outlet()][$today]) ? $sf['checklist'][current_outlet()][$today] : [];
            $lic = isset($sf['licences']) ? $sf['licences'] : default_licences();
            foreach ($lic as &$l) $l['days_left'] = !empty($l['expires_on']) ? (int)floor((strtotime($l['expires_on']) - strtotime('today')) / 86400) : null;
            unset($l);
            $temps = array_values(array_filter(isset($sf['temps']) ? $sf['temps'] : [], function($t) { return (isset($t['outlet_id']) ? $t['outlet_id'] : 'main') === current_outlet(); }));
            echo json_encode(["temps" => array_slice(array_reverse($temps), 0, 60), "limits" => get_settings()['temp_limits'],
                              "checklist" => array_map(function($t, $i) use ($done) { return ["index" => $i, "item" => $t, "done" => isset($done[$i]) ? $done[$i] : null]; }, $items, array_keys($items)),
                              "licences" => $lic, "alerts" => safety_alerts()]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        $sf = read_json("safety.json", []);
        if ($action === 'temp') {
            require_role($staff_user, $STOCK);
            $ok = log_temperature(clean_text(isset($in['equipment']) ? $in['equipment'] : '', 40), floatval(isset($in['value']) ? $in['value'] : 0), "Manual · $staff_user", $staff_user);
            echo json_encode(["status" => "ok", "pass" => $ok]);
        } elseif ($action === 'check') {
            require_role($staff_user, $STOCK);
            $i = intval(isset($in['index']) ? $in['index'] : -1);
            $items = get_settings()['checklist_items'];
            if (!isset($items[$i])) erp_fail("Unknown checklist item.");
            $today = date("Y-m-d");
            if (!empty($in['done'])) $sf['checklist'][current_outlet()][$today][$i] = ["by" => $staff_user, "timestamp" => erp_now()];
            else unset($sf['checklist'][current_outlet()][$today][$i]);
            write_json("safety.json", $sf);
            write_audit_log($staff_user, "Checklist: \"{$items[$i]}\" " . (!empty($in['done']) ? "done" : "un-ticked"));
            echo json_encode(["status" => "ok"]);
        } elseif ($action === 'licence' || $action === 'licence_delete') {
            require_role($staff_user, $MGR);
            $lic = isset($sf['licences']) ? $sf['licences'] : default_licences();
            $id = (string)(isset($in['id']) ? $in['id'] : '');
            if ($action === 'licence_delete') {
                $lic = array_values(array_filter($lic, function($l) use ($id) { return $l['id'] !== $id; }));
            } else {
                $name = clean_text(isset($in['name']) ? $in['name'] : '', 60);
                $exp = isset($in['expires_on']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['expires_on']) ? $in['expires_on'] : '';
                if ($name === '') erp_fail("Enter the document name.");
                $found = false;
                foreach ($lic as &$l) if ($id !== '' && $l['id'] === $id) { $l['name'] = $name; $l['expires_on'] = $exp; $found = true; }
                unset($l);
                if (!$found) $lic[] = ["id" => "lic-" . time() . rand(10, 99), "name" => $name, "expires_on" => $exp];
                write_audit_log($staff_user, "Licence \"$name\" " . ($exp ? "valid until $exp" : "updated"));
            }
            $sf['licences'] = $lic;
            write_json("safety.json", $sf);
            echo json_encode(["status" => "ok"]);
        } else {
            erp_fail("Unknown food-safety action.");
        }
        return true;

    // Webhook for IoT temperature sensors — {equipment, value}
    case 'integrations/sensor':
        if ($method !== 'POST') return false;
        integration_auth();
        $in = erp_input();
        $ok = log_temperature(clean_text(isset($in['equipment']) ? $in['equipment'] : '', 40), floatval(isset($in['value']) ? $in['value'] : 0), "IoT sensor", "Sensor");
        echo json_encode(["status" => "ok", "pass" => $ok]);
        return true;

    // ── Outlets ────────────────────────────────────────────────────────────
    case 'erp/outlets':
        if ($method === 'GET') {
            require_role($staff_user, $ALL);
            $company = get_company_settings();
            $all = read_json("invoices.json", []);
            $today = strtotime('today');
            $active = read_json("active_orders.json", []);
            $out = [];
            foreach (load_outlets() as $o) {
                $sales = 0; $bills = 0;
                foreach ($all as $i) if (invoice_outlet($i) === $o['id'] && strtotime($i['timestamp']) >= $today) { $sales += $i['total']; $bills++; }
                $open = 0;
                foreach ($active as $s) if (session_outlet($s) === $o['id']) $open++;
                $eff = [];
                foreach (outlet_override_keys() as $k) $eff[$k] = isset($o['overrides'][$k]) && $o['overrides'][$k] !== '' && $o['overrides'][$k] !== null ? $o['overrides'][$k] : $company[$k];
                $out[] = array_merge($o, ["sales_today" => money($sales), "bills_today" => $bills, "open_tables" => $open, "effective" => $eff]);
            }
            echo json_encode(["outlets" => $out, "current" => current_outlet(), "company" => array_intersect_key($company, array_flip(outlet_override_keys()))]);
            return true;
        }
        $in = erp_input();
        $action = isset($in['action']) ? $in['action'] : '';
        if ($action === 'switch') {
            require_role($staff_user, $ALL);
            $o = outlet_by_id((string)(isset($in['id']) ? $in['id'] : ''));
            if (!$o) erp_fail("Outlet not found.", 404);
            $_SESSION['outlet'] = $o['id'];
            write_audit_log($staff_user, "Switched to outlet {$o['name']}");
            echo json_encode(["status" => "ok"]);
            return true;
        }
        require_role($staff_user, ['Admin']);
        $list = load_outlets();
        if ($action === 'save') {
            $id = (string)(isset($in['id']) ? $in['id'] : '');
            $name = clean_text(isset($in['name']) ? $in['name'] : '', 60);
            if ($name === '') erp_fail("Enter the outlet name.");
            $type = in_array(isset($in['type']) ? $in['type'] : '', ['Restaurant', 'Central kitchen', 'Bar', 'Cloud kitchen'], true) ? $in['type'] : 'Restaurant';
            $ov = [];
            $raw = isset($in['overrides']) && is_array($in['overrides']) ? $in['overrides'] : [];
            foreach (outlet_override_keys() as $k) {
                if (!isset($raw[$k]) || $raw[$k] === '' || $raw[$k] === null) continue;
                if ($k === 'tables_count') $ov[$k] = max(0, min(200, intval($raw[$k])));
                elseif ($k === 'service_charge_percent') $ov[$k] = max(0, min(20, round(floatval($raw[$k]), 2)));
                elseif ($k === 'invoice_prefix') $ov[$k] = substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string)$raw[$k])), 0, 4);
                elseif ($k === 'gstin') $ov[$k] = strtoupper(clean_text($raw[$k], 20));
                else $ov[$k] = clean_text($raw[$k], 160);
            }
            $found = false;
            foreach ($list as &$o) if ($id !== '' && $o['id'] === $id) { $o['name'] = $name; $o['type'] = $type; $o['overrides'] = $ov; $found = true; }
            unset($o);
            if (!$found) {
                $id = substr(preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), 0, 16) . '-' . bin2hex(random_bytes(2));
                $list[] = ["id" => $id, "name" => $name, "type" => $type, "overrides" => $ov];
            }
            write_json("outlets.json", $list);
            write_audit_log($staff_user, ($found ? "Updated" : "Added") . " outlet $name");
            echo json_encode(["status" => "ok", "id" => $id]);
        } elseif ($action === 'delete') {
            $id = (string)(isset($in['id']) ? $in['id'] : '');
            if ($id === 'main') erp_fail("The main outlet cannot be removed.");
            foreach (read_json("active_orders.json", []) as $s) if (session_outlet($s) === $id) erp_fail("This outlet has open tables. Close them first.");
            $list = array_values(array_filter($list, function($o) use ($id) { return $o['id'] !== $id; }));
            write_json("outlets.json", $list);
            if (isset($_SESSION['outlet']) && $_SESSION['outlet'] === $id) $_SESSION['outlet'] = 'main';
            write_audit_log($staff_user, "Removed outlet $id");
            echo json_encode(["status" => "ok"]);
        } else {
            erp_fail("Unknown outlet action.");
        }
        return true;

    // Small counts for nav badges
    case 'erp/badges':
        require_role($staff_user, $ALL);
        $st = get_settings();
        $b = ["approvals" => 0, "wastage" => 0, "safety" => safety_alerts(), "incoming" => count(read_json("incoming_orders.json", [])), "expiring" => 0];
        foreach (read_json("purchase_orders.json", []) as $po) if ($po['status'] === 'Awaiting approval') $b['approvals']++;
        foreach (read_json("wastage.json", []) as $w) if ($w['status'] === 'Pending approval') $b['wastage']++;
        $soon = strtotime("+" . intval($st['expiry_alert_days']) . " days", strtotime('today'));
        foreach (read_json("inventory.json", ["materials" => []])['materials'] as $m) if (!empty($m['expires_on']) && strtotime($m['expires_on']) <= $soon) $b['expiring']++;
        echo json_encode($b);
        return true;
    }
    return false;
}

// Adds or removes stock for one material (kitchen first) and writes the ledger
function bom_adjust_stock($mid, $delta, $reason, $user) {
    $inv = read_json("inventory.json", ["materials" => []]);
    foreach ($inv['materials'] as &$m) {
        if ($m['id'] !== $mid) continue;
        $k = kitchen_qty($m);
        $m['kitchen_stock'] = $delta < 0 ? round(max(0, $k + $delta), 3) : round($k, 3);
        $m['stock'] = round(floatval($m['stock']) + $delta, 3);
        add_ledger_entries([["timestamp" => erp_now(), "material_id" => $mid, "name" => $m['name'], "delta" => round($delta, 3),
                             "balance" => $m['stock'], "reason" => $reason, "user" => $user ?: 'System']]);
    }
    unset($m);
    write_json("inventory.json", $inv);
}

function clock_staff($sid, $source, $user, $type = null) {
    $staff = read_json("staff.json", []);
    $s = null;
    foreach ($staff as $x) if ($x['id'] === $sid) $s = $x;
    if (!$s) erp_fail("Staff member not found.", 404);
    $att = read_json("attendance.json", []);
    $openIdx = null;
    foreach ($att as $i => $a) if ($a['staff_id'] === $sid && empty($a['out'])) $openIdx = $i;
    $goingIn = $type === null ? $openIdx === null : $type === 'in';
    if ($goingIn) {
        if ($openIdx !== null) return ["status" => "ok", "clocked_in" => true, "note" => "Already clocked in"];
        $att[] = ["id" => "att-" . time() . rand(100, 999), "staff_id" => $sid, "name" => $s['name'], "in" => erp_now(), "out" => null, "source" => $source, "outlet_id" => current_outlet()];
    } else {
        if ($openIdx === null) return ["status" => "ok", "clocked_in" => false, "note" => "Was not clocked in"];
        $att[$openIdx]['out'] = erp_now();
    }
    write_json("attendance.json", array_slice($att, -20000));
    write_audit_log($user, "{$s['name']} clocked " . ($goingIn ? "in" : "out") . " ($source)");
    return ["status" => "ok", "clocked_in" => $goingIn];
}
