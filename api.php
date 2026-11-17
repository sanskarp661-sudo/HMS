<?php
/**
 * api.php — Hostinger PHP Backend Bridge for Downtown Luka
 * Replaces server.py using native PHP JSON flat-file storage.
 * Handles all GET/POST requests routed from /api/* via .htaccess.
 */

// ─── Headers ────────────────────────────────────────────────────────────────
// Same-origin only: the site and the API live on the same domain, so no CORS
// headers are sent. This stops other websites from calling the API with a
// logged-in staff member's session cookie.
header("Content-Type: application/json; charset=UTF-8");
header("X-Content-Type-Options: nosniff");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// ─── Secure staff session ───────────────────────────────────────────────────
// Staff identity now comes ONLY from a server-side PHP session created at
// login. The old X-Staff-User request header is ignored, because anyone
// could set it to "admin".
$is_https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
session_name('LUKASESS');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => $is_https,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

// Log a session out after 12 hours of inactivity
if (isset($_SESSION['last_seen']) && time() - $_SESSION['last_seen'] > 12 * 3600) {
    $_SESSION = [];
    session_destroy();
    session_start();
}
$_SESSION['last_seen'] = time();

// ─── Routing ────────────────────────────────────────────────────────────────
$route = isset($_GET['route']) ? trim($_GET['route'], '/') : '';
$method = $_SERVER['REQUEST_METHOD'];

// Logged-in staff username, or null for customers / anonymous visitors
function get_staff_user() {
    return isset($_SESSION['staff_user']) ? $_SESSION['staff_user'] : null;
}
$staff_user = get_staff_user();

// ─── Helper Functions ────────────────────────────────────────────────────────
// ─── Data storage ───────────────────────────────────────────────────────────
// Live data (orders, invoices, menu edits, users, logs…) must NOT live inside
// the Git-deployed folder: every Git deploy would reset it to the copy in the
// repository. It is kept one level above the website folder ("hms_data"),
// falling back to a protected "data" folder inside it.
function data_dir() {
    static $dir = null;
    if ($dir !== null) return $dir;
    $candidates = [dirname(__DIR__) . '/hms_data', __DIR__ . '/data'];
    foreach ($candidates as $c) {
        if ((is_dir($c) || @mkdir($c, 0750, true)) && is_writable($c)) {
            if (!file_exists($c . '/.htaccess')) {
                @file_put_contents($c . '/.htaccess', "Require all denied\nDeny from all\n");
            }
            if (!is_dir($c . '/uploads')) @mkdir($c . '/uploads', 0750, true);
            $dir = $c;
            return $dir;
        }
    }
    $dir = __DIR__; // last resort: old behaviour
    return $dir;
}

// Full path of a data file. The first time a file is needed it is copied from
// the old location in the website folder (migration) or from data-seed/.
function data_path($filename) {
    $target = data_dir() . '/' . $filename;
    if (!file_exists($target) && data_dir() !== __DIR__) {
        foreach ([__DIR__ . '/' . $filename, __DIR__ . '/data-seed/' . $filename] as $src) {
            if (file_exists($src)) { @copy($src, $target); break; }
        }
    }
    return $target;
}

function read_json($filename, $default = []) {
    $path = data_path($filename);
    if (!file_exists($path)) {
        return $default;
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : $default;
}

function write_json($filename, $data) {
    file_put_contents(data_path($filename), json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

// Strip HTML/script from text typed by customers before it is stored and
// later shown in the admin panel.
function clean_text($value, $max_len = 60) {
    $value = is_string($value) ? $value : '';
    $value = trim(strip_tags($value));
    $value = preg_replace('/[<>"\'`]/u', '', $value);
    return mb_substr($value, 0, $max_len);
}

function clean_phone($value) {
    return substr(preg_replace('/\D/', '', is_scalar($value) ? (string)$value : ''), 0, 15);
}

function clean_table_no($value) {
    return substr(preg_replace('/[^A-Za-z0-9]/', '', is_scalar($value) ? (string)$value : ''), 0, 10);
}

function mask_phone($phone) {
    $phone = (string)$phone;
    if (strlen($phone) <= 4) return $phone;
    return str_repeat('•', strlen($phone) - 4) . substr($phone, -4);
}

function is_password_hash($value) {
    return is_string($value) && password_get_info($value)['algo'] !== null && password_get_info($value)['algo'] !== 0;
}

// Each entry stores the hash of the previous one, so editing or deleting an
// old entry in the file breaks the chain and shows up in "Verify log".
function audit_entry_hash($entry) {
    return hash('sha256', $entry['prev'] . '|' . $entry['timestamp'] . '|' . $entry['user'] . '|' . $entry['action']);
}

function write_audit_log($user, $action) {
    $log = read_json("audit_log.json", []);
    $last = count($log) ? $log[count($log) - 1] : null;
    $entry = [
        "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
        "user" => ($user === null || $user === '') ? 'System' : $user,
        "action" => $action,
        "prev" => ($last && isset($last['hash'])) ? $last['hash'] : str_repeat('0', 64),
    ];
    $entry['hash'] = audit_entry_hash($entry);
    $log[] = $entry;
    // Keep the file from growing forever: retain the latest 5,000 entries
    if (count($log) > 5000) {
        $log = array_slice($log, -5000);
    }
    write_json("audit_log.json", $log);
}

// ─── Settings ───────────────────────────────────────────────────────────────
function default_settings() {
    return [
        "business_name"        => "Downtown Luka",
        "business_address"     => "Cyberhub, Sector 24, Gurugram",
        "business_phone"       => "",
        "gstin"                => "",
        "tables_count"         => 15,
        "payment_methods"      => ["UPI" => true, "Cash" => true, "Card" => true],
        "bom_enabled"          => false,
        "bom_deduct_on"        => "order",   // "order" = when the order is placed, "settle" = when the bill is paid
        "block_on_low_stock"   => false,     // reject orders that would take stock below zero
        // Billing & tax
        "service_charge_percent" => 10,      // optional; staff can remove it on any bill
        "gst_percent"          => 5,         // restaurant GST on food & soft drinks (split CGST/SGST)
        "liquor_vat_percent"   => 20,        // state VAT on alcoholic drinks (outside GST)
        "invoice_prefix"       => "INV",     // invoice no. = PREFIX/FY/00001
        "sac_code"             => "996331",  // SAC for restaurant services
        // UPI
        "upi_id"               => "",
        "upi_name"             => "",
    ];
}

function get_settings() {
    $s = array_replace(default_settings(), read_json("settings.json", []));
    $s['payment_methods'] = array_replace(default_settings()['payment_methods'], is_array($s['payment_methods']) ? $s['payment_methods'] : []);
    return $s;
}

function enabled_payment_methods() {
    $out = [];
    foreach (get_settings()['payment_methods'] as $m => $on) {
        if ($on) $out[] = $m;
    }
    return $out;
}

function require_bom_enabled() {
    // Sign-in is checked first, so anonymous callers learn nothing about settings
    if (get_staff_user() === null) {
        http_response_code(401);
        echo json_encode(["status" => "error", "message" => "Please log in again."]);
        exit;
    }
    if (!get_settings()['bom_enabled']) {
        http_response_code(400);
        echo json_encode(["status" => "error", "message" => "BOM & Inventory is turned off. An Admin can enable it in Settings."]);
        exit;
    }
}

function money($v) {
    return round(floatval($v), 2);
}

function lookup_menu_item_any($item_id) {
    $md = read_json("menu_data.json", []);
    foreach (isset($md['items']) ? $md['items'] : [] as $it) {
        if (isset($it['id']) && $it['id'] === $item_id) return $it;
    }
    return null;
}


// ─── Validation ─────────────────────────────────────────────────────────────
function valid_indian_mobile($phone) {
    return (bool)preg_match('/^[6-9][0-9]{9}$/', $phone);
}

function client_ip() {
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
}

// ─── Rate limiting (login and table PIN) ───────────────────────────────────
function rate_limited($key, $max, $window) {
    $all = read_json("login_attempts.json", []);
    $now = time();
    if (isset($all[$key]) && $all[$key]['first'] + $window < $now) unset($all[$key]);
    return isset($all[$key]) && $all[$key]['count'] >= $max
        ? ($all[$key]['first'] + $window - $now) : 0;
}

function rate_fail($key, $window) {
    $all = read_json("login_attempts.json", []);
    $now = time();
    foreach ($all as $k => $v) if ($v['first'] + $window < $now) unset($all[$k]); // tidy old entries
    if (!isset($all[$key])) $all[$key] = ["first" => $now, "count" => 0];
    $all[$key]['count']++;
    write_json("login_attempts.json", $all);
}

function rate_clear($key) {
    $all = read_json("login_attempts.json", []);
    unset($all[$key]);
    write_json("login_attempts.json", $all);
}

// ─── Table sessions ─────────────────────────────────────────────────────────
// A table session belongs to ONE dining party. The guest who opens it gets a
// secret token (kept on their phone) and a 4-digit table PIN to share with
// friends at the same table. Without the token or PIN nobody can see or add
// to that party's bill. Settling or closing the table ends the session.
function new_session($table_no, $name, $phone) {
    return [
        "table_no" => $table_no,
        "session_id" => "sess_" . time() . "_" . bin2hex(random_bytes(3)),
        "token" => bin2hex(random_bytes(24)),
        "pin" => str_pad((string)random_int(0, 9999), 4, "0", STR_PAD_LEFT),
        "customer_name" => $name,
        "customer_phone" => $phone,
        "status" => "Active",
        "started_at" => gmdate("Y-m-d\TH:i:s\Z"),
        "service_charge_on" => true,
        "discount" => null,
        "orders" => [],
        "voids" => [],
    ];
}

// Older sessions (before this change) get a token and PIN on first use
function normalize_sessions(&$active) {
    $changed = false;
    foreach ($active as $k => &$s) {
        if (!is_array($s)) continue;
        if (empty($s['token'])) { $s['token'] = bin2hex(random_bytes(24)); $changed = true; }
        if (empty($s['pin'])) { $s['pin'] = str_pad((string)random_int(0, 9999), 4, "0", STR_PAD_LEFT); $changed = true; }
        if (!isset($s['service_charge_on'])) { $s['service_charge_on'] = true; $changed = true; }
        if (!isset($s['discount'])) { $s['discount'] = null; $changed = true; }
        if (!isset($s['voids'])) { $s['voids'] = []; $changed = true; }
        if (!isset($s['started_at'])) { $s['started_at'] = isset($s['orders'][0]['timestamp']) ? $s['orders'][0]['timestamp'] : gmdate("Y-m-d\TH:i:s\Z"); $changed = true; }
    }
    unset($s);
    return $changed;
}

function load_sessions() {
    $active = read_json("active_orders.json", []);
    if (normalize_sessions($active)) write_json("active_orders.json", $active);
    return $active;
}

function table_token() {
    if (isset($_SERVER['HTTP_X_TABLE_TOKEN'])) return (string)$_SERVER['HTTP_X_TABLE_TOKEN'];
    return '';
}

// For guest requests: returns the session key only if the token matches
function guest_session_key($active, $table_no) {
    $key = "table_" . $table_no;
    $tok = table_token();
    if ($table_no === '' || !isset($active[$key])) {
        http_response_code(404);
        echo json_encode(["status" => "error", "code" => "no_session", "message" => "This table's bill has been closed. Please start a new order."]);
        exit;
    }
    if ($tok === '' || !hash_equals($active[$key]['token'], $tok)) {
        http_response_code(403);
        echo json_encode(["status" => "error", "code" => "not_your_table", "message" => "This table is being used by another party. Ask them for the table PIN, or ask our staff."]);
        exit;
    }
    return $key;
}

// What a guest is allowed to see about their own session
function guest_view($s) {
    return [
        "table_no" => $s['table_no'],
        "status" => $s['status'],
        "customer_name" => $s['customer_name'],
        "pin" => $s['pin'],
        "orders" => $s['orders'],
        "bill" => compute_bill($s),
    ];
}

// ─── Billing engine ─────────────────────────────────────────────────────────
// Food & soft drinks: GST (shown as CGST + SGST, half each).
// Alcoholic drinks: outside GST — state VAT on a separate line.
// Service charge is optional (CCPA guidelines) and taxed with the item it
// relates to. Discount reduces the taxable value. Total rounded to the rupee.
function item_tax_class($item) {
    static $cache = [];
    $id = isset($item['id']) ? $item['id'] : '';
    if ($id === '') return 'food';
    if (!isset($cache[$id])) {
        $m = lookup_menu_item_any($id);
        $cache[$id] = ($m && in_array('Alcoholic', isset($m['tags']) ? $m['tags'] : [], true)) ? 'liquor' : 'food';
    }
    return $cache[$id];
}

function compute_bill($session) {
    $st = get_settings();
    $lines = [];
    $sub = ["food" => 0, "liquor" => 0];
    foreach ($session['orders'] as $ord) {
        foreach ($ord['items'] as $it) {
            $variant = isset($it['variant']) ? $it['variant'] : 'Portion';
            $k = (isset($it['id']) ? $it['id'] : $it['name']) . '||' . $variant;
            $cls = item_tax_class($it);
            if (!isset($lines[$k])) {
                $lines[$k] = ["id" => isset($it['id']) ? $it['id'] : '', "name" => $it['name'], "variant" => $variant,
                              "price" => floatval($it['price']), "quantity" => 0, "tax_class" => $cls];
            }
            $lines[$k]['quantity'] += intval($it['quantity']);
            $sub[$cls] += floatval($it['price']) * intval($it['quantity']);
        }
    }
    $subtotal = money($sub['food'] + $sub['liquor']);

    // Discount (percent or fixed), shared across food/liquor in proportion
    $disc = 0;
    $d = isset($session['discount']) ? $session['discount'] : null;
    if (is_array($d) && $subtotal > 0) {
        $disc = $d['type'] === 'pct' ? $subtotal * min(100, max(0, $d['value'])) / 100 : min($subtotal, max(0, $d['value']));
    }
    $disc = money($disc);
    $ratio = $subtotal > 0 ? ($subtotal - $disc) / $subtotal : 0;
    $net = ["food" => $sub['food'] * $ratio, "liquor" => $sub['liquor'] * $ratio];

    $sc_pct = !empty($session['service_charge_on']) ? floatval($st['service_charge_percent']) : 0;
    $sc = ["food" => $net['food'] * $sc_pct / 100, "liquor" => $net['liquor'] * $sc_pct / 100];

    $food_taxable = money($net['food'] + $sc['food']);
    $liquor_taxable = money($net['liquor'] + $sc['liquor']);
    $gst = floatval($st['gst_percent']);
    $vat = floatval($st['liquor_vat_percent']);
    $cgst = money($food_taxable * $gst / 200);
    $sgst = money($food_taxable * $gst / 200);
    $vat_amt = money($liquor_taxable * $vat / 100);
    $service_charge = money($sc['food'] + $sc['liquor']);

    $before_round = money($subtotal - $disc + $service_charge + $cgst + $sgst + $vat_amt);
    $total = round($before_round);
    return [
        "items" => array_values($lines),
        "food_subtotal" => money($sub['food']),
        "liquor_subtotal" => money($sub['liquor']),
        "subtotal" => $subtotal,
        "discount" => $disc,
        "discount_info" => $d,
        "service_charge_on" => !empty($session['service_charge_on']),
        "service_charge_percent" => $sc_pct,
        "service_charge" => $service_charge,
        "food_taxable" => $food_taxable,
        "liquor_taxable" => $liquor_taxable,
        "gst_percent" => $gst,
        "cgst" => $cgst,
        "sgst" => $sgst,
        "liquor_vat_percent" => $vat,
        "vat" => $vat_amt,
        "tax" => money($cgst + $sgst + $vat_amt),
        "round_off" => money($total - $before_round),
        "total" => money($total),
    ];
}

// Sequential invoice number per Indian financial year (Apr–Mar), e.g. INV/26-27/00042
function next_invoice_no($invoices, $prefix) {
    $y = intval(gmdate("Y"));
    $m = intval(gmdate("n"));
    $start = $m >= 4 ? $y : $y - 1;
    $fy = substr((string)$start, 2) . "-" . substr((string)($start + 1), 2);
    $head = $prefix . "/" . $fy . "/";
    $n = 0;
    foreach ($invoices as $inv) {
        if (isset($inv['invoice_no']) && strpos($inv['invoice_no'], $head) === 0) {
            $n = max($n, intval(substr($inv['invoice_no'], strlen($head))));
        }
    }
    return $head . str_pad($n + 1, 5, "0", STR_PAD_LEFT);
}

// ─── Customers (one record per mobile number — no duplicates) ──────────────
function load_customers() {
    $path = data_path("customers.json");
    if (!file_exists($path)) {
        // First run: build the list from past invoices
        $c = [];
        foreach (read_json("invoices.json", []) as $inv) {
            $ph = clean_phone(isset($inv['customer_phone']) ? $inv['customer_phone'] : '');
            if (!valid_indian_mobile($ph)) continue;
            if (!isset($c[$ph])) $c[$ph] = ["phone" => $ph, "name" => $inv['customer_name'], "first_seen" => $inv['timestamp'],
                                             "last_seen" => $inv['timestamp'], "visits" => 0, "invoices" => 0, "total_spent" => 0, "notes" => ""];
            $c[$ph]['visits']++;
            $c[$ph]['invoices']++;
            $c[$ph]['total_spent'] = money($c[$ph]['total_spent'] + $inv['total']);
            if ($inv['timestamp'] >= $c[$ph]['last_seen']) { $c[$ph]['last_seen'] = $inv['timestamp']; $c[$ph]['name'] = $inv['customer_name']; }
            if ($inv['timestamp'] < $c[$ph]['first_seen']) $c[$ph]['first_seen'] = $inv['timestamp'];
        }
        write_json("customers.json", (object)$c);
        return $c;
    }
    return read_json("customers.json", []);
}

function customer_visit($phone, $name) {
    if (!valid_indian_mobile($phone)) return;
    $c = load_customers();
    $now = gmdate("Y-m-d\TH:i:s\Z");
    if (!isset($c[$phone])) {
        $c[$phone] = ["phone" => $phone, "name" => $name, "first_seen" => $now, "last_seen" => $now,
                      "visits" => 0, "invoices" => 0, "total_spent" => 0, "notes" => ""];
    }
    $c[$phone]['name'] = $name;          // keep the latest name they gave
    $c[$phone]['last_seen'] = $now;
    $c[$phone]['visits']++;
    write_json("customers.json", (object)$c);
}

function customer_invoice($phone, $total) {
    if (!valid_indian_mobile($phone)) return;
    $c = load_customers();
    if (!isset($c[$phone])) return;
    $c[$phone]['invoices']++;
    $c[$phone]['total_spent'] = money($c[$phone]['total_spent'] + $total);
    write_json("customers.json", (object)$c);
}

// ─── BOM / Inventory helpers ────────────────────────────────────────────────
// inventory.json : { "materials": [ {id, name, unit, stock, reorder_level, cost_per_unit} ] }
// bom.json       : { "<item_id>": { "<variant label>": [ {material_id, qty} ] } }
// stock_ledger.json : [ {timestamp, material_id, name, delta, balance, reason, user} ]
function add_ledger_entries($entries) {
    if (count($entries) === 0) return;
    $ledger = read_json("stock_ledger.json", []);
    foreach ($entries as $e) $ledger[] = $e;
    if (count($ledger) > 5000) $ledger = array_slice($ledger, -5000);
    write_json("stock_ledger.json", $ledger);
}

// Works out how much of each raw material a list of sold items uses.
function bom_requirements($items) {
    $bom = read_json("bom.json", []);
    $need = [];
    foreach ($items as $it) {
        $id = isset($it['id']) ? $it['id'] : '';
        $variant = isset($it['variant']) ? $it['variant'] : '';
        $qty = isset($it['quantity']) ? intval($it['quantity']) : 0;
        if ($id === '' || $qty < 1 || !isset($bom[$id][$variant]) || !is_array($bom[$id][$variant])) continue;
        foreach ($bom[$id][$variant] as $ing) {
            $mid = isset($ing['material_id']) ? $ing['material_id'] : '';
            if ($mid === '') continue;
            $need[$mid] = (isset($need[$mid]) ? $need[$mid] : 0) + floatval($ing['qty']) * $qty;
        }
    }
    return $need;
}

// Returns a list of materials that do not have enough stock (empty = all fine).
function bom_shortages($need) {
    $inv = read_json("inventory.json", ["materials" => []]);
    $short = [];
    foreach ($inv['materials'] as $m) {
        if (isset($need[$m['id']]) && floatval($m['stock']) < $need[$m['id']]) {
            $short[] = $m['name'];
        }
    }
    return $short;
}

// Deducts stock for sold items and records each movement in the ledger.
// Puts stock back (e.g. an item was voided after stock was deducted)
function bom_restock($items, $reason, $user) {
    bom_deduct($items, $reason, $user, -1);
}

function bom_deduct($items, $reason, $user, $sign = 1) {
    $need = bom_requirements($items);
    if (count($need) === 0) return;
    $inv = read_json("inventory.json", ["materials" => []]);
    $entries = [];
    foreach ($inv['materials'] as &$m) {
        if (!isset($need[$m['id']])) continue;
        $m['stock'] = round(floatval($m['stock']) - $sign * $need[$m['id']], 3);
        $entries[] = [
            "timestamp"   => gmdate("Y-m-d\TH:i:s\Z"),
            "material_id" => $m['id'],
            "name"        => $m['name'],
            "delta"       => -$sign * round($need[$m['id']], 3),
            "balance"     => $m['stock'],
            "reason"      => $reason,
            "user"        => $user ?: 'System',
        ];
    }
    unset($m);
    write_json("inventory.json", $inv);
    add_ledger_entries($entries);
}

// Role is re-read from users.json on every request, so a deleted or
// demoted account loses access immediately.
function get_user_role($username) {
    if ($username === null) return null;
    $users = read_json("users.json", []);
    $user_lower = strtolower($username);
    if (isset($users[$user_lower]) && is_array($users[$user_lower])) {
        return isset($users[$user_lower]['role']) ? $users[$user_lower]['role'] : null;
    }
    return null;
}

function require_role($username, $allowed_roles) {
    if ($username === null) {
        http_response_code(401);
        echo json_encode(["status" => "error", "message" => "Please log in again."]);
        exit;
    }
    $role = get_user_role($username);
    if ($role === null) {
        // Account was deleted while logged in
        $_SESSION = [];
        session_destroy();
        http_response_code(401);
        echo json_encode(["status" => "error", "message" => "Your account no longer exists. Please log in again."]);
        exit;
    }
    if (!in_array($role, $allowed_roles, true)) {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Permission denied. Required role: " . implode(" or ", $allowed_roles)]);
        exit;
    }
    return $role;
}

// Looks up the real name and price of a menu item, so customers cannot send
// their own prices from the browser.
function lookup_menu_item($item_id, $variant_label) {
    static $index = null;
    if ($index === null) {
        $index = [];
        $md = read_json("menu_data.json", []);
        if (isset($md['items']) && is_array($md['items'])) {
            foreach ($md['items'] as $it) {
                if (isset($it['id'])) $index[$it['id']] = $it;
            }
        }
    }
    if (!isset($index[$item_id])) return null;
    $item = $index[$item_id];
    if (isset($item['status']) && $item['status'] !== 'Published') return null;
    if (isset($item['availability']) && $item['availability'] === "86'd") return null;
    $variants = isset($item['price_variants']) && is_array($item['price_variants']) ? $item['price_variants'] : [];
    foreach ($variants as $v) {
        if (isset($v['label']) && $v['label'] === $variant_label) {
            return ["id" => $item['id'], "name" => $item['name'], "variant" => $v['label'], "price" => floatval($v['price'])];
        }
    }
    return null;
}

// ─── Uploaded media (served from the data folder) ────────────────────────────
if (strpos($route, 'media/') === 0) {
    $name = basename(substr($route, 6));
    $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'mp4' => 'video/mp4'];
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $file = data_dir() . '/uploads/' . $name;
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $name) || !isset($types[$ext]) || !is_file($file)) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "File not found."]);
        exit;
    }
    header_remove("Pragma");
    header("Content-Type: " . $types[$ext]);
    header("Content-Length: " . filesize($file));
    header("Cache-Control: public, max-age=604800");
    readfile($file);
    exit;
}

// ─── API Endpoint Router ────────────────────────────────────────────────────
switch ($route) {
    
    // 1. GET/POST /api/menu
    case 'menu':
        if ($method === 'GET') {
            echo json_encode(read_json("menu_data.json", ["categories" => [], "items" => []]));
        } elseif ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $input = json_decode(file_get_contents("php://input"), true);
            if (!is_array($input) || !isset($input['categories'], $input['items']) || !is_array($input['items'])) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Invalid menu data."]);
                exit;
            }
            write_json("menu_data.json", ["categories" => $input['categories'], "items" => $input['items']]);
            // The page describes what changed (e.g. 'Updated menu item: "Dal Makhani"')
            $action = isset($_SERVER['HTTP_X_AUDIT_ACTION']) ? clean_text(urldecode($_SERVER['HTTP_X_AUDIT_ACTION']), 200) : '';
            write_audit_log($staff_user, $action !== '' ? $action : "Modified Menu Catalog");
            echo json_encode(["status" => "ok"]);
        }
        break;

    // 2. POST /api/upload
    case 'upload':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist', 'Waiter']);
            if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
                if (!is_dir('uploads')) {
                    mkdir('uploads', 0755, true);
                }
                // Only images and MP4 video are accepted. Anything else
                // (e.g. a .php script) is rejected, and the file name is
                // generated by the server.
                $allowed = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
                            'webp' => 'image/webp', 'gif' => 'image/gif', 'mp4' => 'video/mp4'];
                $ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
                $mime = function_exists('mime_content_type') ? mime_content_type($_FILES['file']['tmp_name']) : '';
                if (!isset($allowed[$ext]) || ($mime !== '' && $mime !== $allowed[$ext])) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Only JPG, PNG, WEBP, GIF or MP4 files are allowed."]);
                    exit;
                }
                if ($_FILES['file']['size'] > 20 * 1024 * 1024) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "File is too large (max 20 MB)."]);
                    exit;
                }
                $filename = 'item-' . time() . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
                // Stored with the live data (outside the Git folder) and served by /api/media/
                $target = data_dir() . '/uploads/' . $filename;
                if (move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
                    echo json_encode(["status" => "success", "url" => "api/media/" . $filename]);
                } else {
                    http_response_code(500);
                    echo json_encode(["status" => "error", "message" => "Failed to save file"]);
                }
            } else {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "No file uploaded"]);
            }
        }
        break;

    // 3. POST /api/login
    case 'login':
        if ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $username = isset($input['username']) ? trim($input['username']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            
            $users = read_json("users.json", []);
            $user_lower = strtolower($username);
            $ok = false;

            // Brute-force protection: 5 wrong attempts per user+IP → locked for 15 minutes
            $rl = "login|" . client_ip() . "|" . substr($user_lower, 0, 40);
            if ($wait = rate_limited($rl, 5, 900)) {
                http_response_code(429);
                echo json_encode(["status" => "error", "message" => "Too many failed sign-in attempts. Try again in " . ceil($wait / 60) . " minutes."]);
                exit;
            }

            if ($username !== '' && is_string($password) && $password !== '' && isset($users[$user_lower]['password'])) {
                $stored = $users[$user_lower]['password'];
                if (is_password_hash($stored)) {
                    $ok = password_verify($password, $stored);
                } else {
                    // Old plain-text password: accept once, then replace it
                    // with a secure hash automatically.
                    $ok = hash_equals((string)$stored, $password);
                    if ($ok) {
                        $users[$user_lower]['password'] = password_hash($password, PASSWORD_DEFAULT);
                        write_json("users.json", $users);
                    }
                }
            }

            if ($ok) {
                rate_clear($rl);
                session_regenerate_id(true);
                $_SESSION['staff_user'] = $user_lower;
                $_SESSION['last_seen'] = time();
                write_audit_log($user_lower, "Logged in");
                echo json_encode([
                    "status" => "success",
                    "username" => $user_lower,
                    "role" => $users[$user_lower]['role']
                ]);
            } else {
                rate_fail($rl, 900);
                write_audit_log("Security", "Failed sign-in for \"" . clean_text($username, 40) . "\" from " . client_ip());
                usleep(500000); // slow down password guessing
                http_response_code(401);
                echo json_encode(["status" => "error", "message" => "Invalid username or passcode."]);
            }
        }
        break;

    // 3b. POST /api/logout
    case 'logout':
        if ($staff_user !== null) {
            write_audit_log($staff_user, "Logged out");
        }
        $_SESSION = [];
        session_destroy();
        echo json_encode(["status" => "ok"]);
        break;

    // 3c. GET /api/session — tells the page whether the login is still valid
    case 'session':
        $role = get_user_role($staff_user);
        if ($staff_user !== null && $role !== null) {
            echo json_encode(["authenticated" => true, "username" => $staff_user, "role" => $role]);
        } else {
            echo json_encode(["authenticated" => false]);
        }
        break;

    // 4. GET/POST /api/users
    case 'users':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin']);
            // Passwords are never sent to the browser
            $users = read_json("users.json", []);
            $safe = [];
            foreach ($users as $name => $profile) {
                $safe[$name] = ["role" => isset($profile['role']) ? $profile['role'] : 'Waiter'];
            }
            echo json_encode($safe);
        } elseif ($method === 'POST') {
            require_role($staff_user, ['Admin']);
            $input = json_decode(file_get_contents("php://input"), true);
            if (!is_array($input)) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Invalid user data."]);
                exit;
            }
            $existing = read_json("users.json", []);
            $valid_roles = ['Admin', 'Owner', 'Receptionist', 'Waiter', 'Kitchen'];
            $new_users = [];
            foreach ($input as $name => $profile) {
                $name = strtolower(trim((string)$name));
                if (!preg_match('/^[a-z0-9._-]{2,32}$/', $name) || !is_array($profile)) continue;
                $role = isset($profile['role']) && in_array($profile['role'], $valid_roles, true) ? $profile['role'] : 'Waiter';
                $pw = isset($profile['password']) ? (string)$profile['password'] : '';
                if ($pw !== '') {
                    if (strlen($pw) < 6) {
                        http_response_code(400);
                        echo json_encode(["status" => "error", "message" => "Password for '$name' must be at least 6 characters."]);
                        exit;
                    }
                    $hash = password_hash($pw, PASSWORD_DEFAULT);
                } elseif (isset($existing[$name]['password'])) {
                    $hash = $existing[$name]['password']; // blank = keep current password
                } else {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "A password is required for new user '$name'."]);
                    exit;
                }
                $new_users[$name] = ["password" => $hash, "role" => $role];
            }
            // Never allow the last Admin, or yourself, to be removed or demoted
            if (!isset($new_users[$staff_user]) || $new_users[$staff_user]['role'] !== 'Admin') {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "You cannot delete or demote your own admin account."]);
                exit;
            }
            write_json("users.json", $new_users);
            write_audit_log($staff_user, "Updated User Configuration Profile database");
            echo json_encode(["status" => "ok"]);
        }
        break;

    // 5. GET /api/audit-log
    case 'audit-log':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $log = read_json("audit_log.json", []);
            $clean = [];
            foreach ($log as $entry) {
                if (!is_array($entry)) continue;
                $clean[] = [
                    "timestamp" => isset($entry['timestamp']) ? (string)$entry['timestamp'] : '',
                    "user"      => isset($entry['user']) ? (string)$entry['user'] : 'System',
                    "action"    => isset($entry['action']) ? (string)$entry['action'] : '',
                ];
            }
            usort($clean, function($a, $b) {
                return strcmp($b['timestamp'], $a['timestamp']); // newest first
            });
            echo json_encode(array_slice($clean, 0, 2000));
        }
        break;

    // 6a. GET /api/table/status?table=N — free or busy (no guest details)
    case 'table/status':
        $table_no = clean_table_no(isset($_GET['table']) ? $_GET['table'] : '');
        $active = load_sessions();
        echo json_encode(["table_no" => $table_no, "busy" => $table_no !== '' && isset($active["table_" . $table_no])]);
        break;

    // 6b. POST /api/table/start {table_no, name, phone} — open a new party's tab
    case 'table/start':
        if ($method !== 'POST') break;
        $input = json_decode(file_get_contents("php://input"), true);
        $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
        $name = clean_text(isset($input['name']) ? $input['name'] : '', 40);
        $phone = clean_phone(isset($input['phone']) ? $input['phone'] : '');
        if ($table_no === '') { http_response_code(400); echo json_encode(["status" => "error", "message" => "Missing table number."]); exit; }
        if (mb_strlen($name) < 2) { http_response_code(400); echo json_encode(["status" => "error", "message" => "Please enter your name."]); exit; }
        if (!valid_indian_mobile($phone)) { http_response_code(400); echo json_encode(["status" => "error", "message" => "Please enter a valid 10-digit mobile number."]); exit; }
        $active = load_sessions();
        $key = "table_" . $table_no;
        if (isset($active[$key])) {
            http_response_code(409);
            echo json_encode(["status" => "error", "code" => "table_busy", "message" => "This table already has an open bill. If you're with that group, enter the table PIN. Otherwise please ask our staff."]);
            exit;
        }
        $active[$key] = new_session($table_no, $name, $phone);
        write_json("active_orders.json", $active);
        customer_visit($phone, $name);
        write_audit_log("Customer", "Opened Table $table_no for $name (" . mask_phone($phone) . ")");
        echo json_encode(["status" => "ok", "token" => $active[$key]['token'], "session" => guest_view($active[$key])]);
        break;

    // 6c. POST /api/table/join {table_no, pin} — join your group's open tab
    case 'table/join':
        if ($method !== 'POST') break;
        $input = json_decode(file_get_contents("php://input"), true);
        $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
        $pin = preg_replace('/\D/', '', isset($input['pin']) ? (string)$input['pin'] : '');
        $rl = "pin|" . client_ip() . "|" . $table_no;
        if ($wait = rate_limited($rl, 5, 600)) {
            http_response_code(429);
            echo json_encode(["status" => "error", "message" => "Too many wrong PINs. Please ask our staff, or try again in " . ceil($wait / 60) . " min."]);
            exit;
        }
        $active = load_sessions();
        $key = "table_" . $table_no;
        if (!isset($active[$key])) { http_response_code(404); echo json_encode(["status" => "error", "code" => "no_session", "message" => "This table has no open bill. Start a new order instead."]); exit; }
        if (!hash_equals($active[$key]['pin'], $pin)) {
            rate_fail($rl, 600);
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "That PIN is not correct."]);
            exit;
        }
        rate_clear($rl);
        write_audit_log("Customer", "Another guest joined Table $table_no with the table PIN");
        echo json_encode(["status" => "ok", "token" => $active[$key]['token'], "session" => guest_view($active[$key])]);
        break;

    // 6d. GET /api/table/session?table=N (X-Table-Token) — the guest's own tab
    case 'table/session':
        $table_no = clean_table_no(isset($_GET['table']) ? $_GET['table'] : '');
        $active = load_sessions();
        $key = guest_session_key($active, $table_no);
        echo json_encode(guest_view($active[$key]));
        break;

    // 6e. GET /api/orders — staff: all open tables.  POST — guest places a round.
    case 'orders':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist', 'Waiter']);
            $active = load_sessions();
            $out = [];
            foreach ($active as $k => $sess) {
                unset($sess['token']);                 // staff never need the guest's secret
                $sess['bill_total'] = compute_bill($sess)['total'];
                $out[$k] = $sess;
            }
            echo json_encode((object)$out);
        } elseif ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
            $active = load_sessions();
            $key = guest_session_key($active, $table_no);
            if ($active[$key]['status'] === 'Checkout Requested') {
                // Ordering again re-opens the tab
                $active[$key]['status'] = 'Active';
            }

            // Names and prices come from menu_data.json, never from the browser
            $items = [];
            $raw_items = isset($input['items']) && is_array($input['items']) ? $input['items'] : [];
            foreach ($raw_items as $it) {
                if (!is_array($it)) continue;
                $found = lookup_menu_item(isset($it['id']) ? (string)$it['id'] : '', isset($it['variant']) ? (string)$it['variant'] : '');
                $qty = isset($it['quantity']) ? intval($it['quantity']) : 0;
                if ($found === null || $qty < 1) continue;
                $found['quantity'] = min($qty, 50);
                $items[] = $found;
            }
            if (count($items) === 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Your cart has no valid items. Please refresh the menu and try again."]);
                exit;
            }

            $settings = get_settings();
            if ($settings['bom_enabled'] && $settings['block_on_low_stock']) {
                $short = bom_shortages(bom_requirements($items));
                if (count($short) > 0) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "Sorry, some items are out of stock right now (" . implode(", ", $short) . "). Please ask our staff."]);
                    exit;
                }
            }

            $order_id = "ord_" . time() . rand(100, 999);
            $active[$key]['orders'][] = [
                "order_id" => $order_id,
                "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
                "status" => "Received",
                "items" => $items
            ];
            write_json("active_orders.json", $active);
            write_audit_log("Customer", "Placed order round for Table $table_no (" . count($items) . " items)");
            if ($settings['bom_enabled'] && $settings['bom_deduct_on'] === 'order') {
                bom_deduct($items, "Order $order_id (Table $table_no)", "Customer");
            }
            echo json_encode(["status" => "ok", "message" => "Order round placed.", "order_id" => $order_id, "session" => guest_view($active[$key])]);
        }
        break;

    // 7. POST /api/orders/update-status (kitchen status of a round)
    case 'orders/update-status':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist', 'Waiter']);
            $input = json_decode(file_get_contents("php://input"), true);
            $order_id = isset($input['order_id']) ? (string)$input['order_id'] : '';
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
            $new_status = isset($input['status']) ? (string)$input['status'] : '';
            if (!in_array($new_status, ['Received', 'Preparing', 'Ready', 'Served'], true)) {
                http_response_code(400); echo json_encode(["status" => "error", "message" => "Unknown status."]); exit;
            }
            $active = load_sessions();
            $key = "table_" . $table_no;
            $updated = false;
            if (isset($active[$key])) {
                foreach ($active[$key]['orders'] as &$o) {
                    if ($o['order_id'] === $order_id) {
                        $o['status'] = $new_status;
                        if ($new_status === 'Served') $o['completed_at'] = gmdate("Y-m-d\TH:i:s\Z");
                        $updated = true;
                        break;
                    }
                }
                unset($o);
            }
            if ($updated) {
                write_json("active_orders.json", $active);
                write_audit_log($staff_user, "Updated Table $table_no order $order_id status to $new_status");
                echo json_encode(["status" => "ok"]);
            } else {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "Order not found."]);
            }
        }
        break;

    // 8. POST /api/orders/request-checkout (guest asks for the bill)
    case 'orders/request-checkout':
        if ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
            $active = load_sessions();
            $key = guest_session_key($active, $table_no);
            $active[$key]['status'] = 'Checkout Requested';
            write_json("active_orders.json", $active);
            write_audit_log("Customer", "Table $table_no asked for the bill");
            echo json_encode(["status" => "ok", "session" => guest_view($active[$key])]);
        }
        break;

    // 8b. GET /api/orders/bill-preview?table=N — the exact bill staff will settle
    case 'orders/bill-preview':
        require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
        $table_no = clean_table_no(isset($_GET['table']) ? $_GET['table'] : '');
        $active = load_sessions();
        if (!isset($active["table_" . $table_no])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "No open bill on this table."]); exit; }
        echo json_encode(compute_bill($active["table_" . $table_no]));
        break;

    // 8c. POST /api/orders/adjust {table_no, service_charge_on?, discount?} — before settling
    case 'orders/adjust':
        if ($method !== 'POST') break;
        require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
        $input = json_decode(file_get_contents("php://input"), true);
        $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
        $active = load_sessions();
        $key = "table_" . $table_no;
        if (!isset($active[$key])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "No open bill on this table."]); exit; }
        $notes = [];
        if (array_key_exists('service_charge_on', $input)) {
            $on = (bool)$input['service_charge_on'];
            if ($on !== (bool)$active[$key]['service_charge_on']) {
                $active[$key]['service_charge_on'] = $on;
                $notes[] = $on ? "added service charge back" : "removed service charge";
            }
        }
        if (array_key_exists('discount', $input)) {
            $d = $input['discount'];
            if ($d === null || (is_array($d) && floatval(isset($d['value']) ? $d['value'] : 0) <= 0)) {
                if ($active[$key]['discount'] !== null) $notes[] = "removed discount";
                $active[$key]['discount'] = null;
            } else {
                $type = (isset($d['type']) && $d['type'] === 'amt') ? 'amt' : 'pct';
                $val = round(floatval($d['value']), 2);
                $reason = clean_text(isset($d['reason']) ? $d['reason'] : '', 80);
                if ($reason === '') { http_response_code(400); echo json_encode(["status" => "error", "message" => "Enter a reason for the discount."]); exit; }
                if ($type === 'pct' && $val > 100) { http_response_code(400); echo json_encode(["status" => "error", "message" => "Discount cannot be more than 100%."]); exit; }
                $active[$key]['discount'] = ["type" => $type, "value" => $val, "reason" => $reason, "by" => $staff_user];
                $notes[] = "discount " . ($type === 'pct' ? "$val%" : "₹$val") . " ($reason)";
            }
        }
        write_json("active_orders.json", $active);
        if (count($notes)) write_audit_log($staff_user, "Table $table_no bill: " . implode("; ", $notes));
        echo json_encode(["status" => "ok", "bill" => compute_bill($active[$key])]);
        break;

    // 8d. POST /api/orders/void-item {table_no, order_id, index, qty, reason}
    case 'orders/void-item':
        if ($method !== 'POST') break;
        require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
        $input = json_decode(file_get_contents("php://input"), true);
        $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
        $order_id = isset($input['order_id']) ? (string)$input['order_id'] : '';
        $idx = intval(isset($input['index']) ? $input['index'] : -1);
        $qty = max(1, intval(isset($input['qty']) ? $input['qty'] : 1));
        $reason = clean_text(isset($input['reason']) ? $input['reason'] : '', 80);
        if ($reason === '') { http_response_code(400); echo json_encode(["status" => "error", "message" => "Enter a reason for the void."]); exit; }
        $active = load_sessions();
        $key = "table_" . $table_no;
        $voided = null;
        if (isset($active[$key])) {
            foreach ($active[$key]['orders'] as $oi => &$o) {
                if ($o['order_id'] !== $order_id || !isset($o['items'][$idx])) continue;
                $line = $o['items'][$idx];
                $qty = min($qty, intval($line['quantity']));
                $voided = array_merge($line, ["quantity" => $qty]);
                if ($qty >= intval($line['quantity'])) array_splice($o['items'], $idx, 1);
                else $o['items'][$idx]['quantity'] = intval($line['quantity']) - $qty;
                if (count($o['items']) === 0) array_splice($active[$key]['orders'], $oi, 1);
                break;
            }
            unset($o);
        }
        if ($voided === null) { http_response_code(404); echo json_encode(["status" => "error", "message" => "Item not found on this table."]); exit; }
        $active[$key]['voids'][] = ["timestamp" => gmdate("Y-m-d\TH:i:s\Z"), "user" => $staff_user, "item" => $voided, "reason" => $reason];
        write_json("active_orders.json", $active);
        $st = get_settings();
        if ($st['bom_enabled'] && $st['bom_deduct_on'] === 'order') {
            bom_restock([$voided], "Void on Table $table_no — $reason", $staff_user);
        }
        write_audit_log($staff_user, "Voided {$qty} × {$voided['name']} ({$voided['variant']}, ₹" . money($voided['price'] * $qty) . ") on Table $table_no — $reason");
        echo json_encode(["status" => "ok", "bill" => compute_bill($active[$key])]);
        break;

    // 8e. POST /api/orders/close-table {table_no, reason} — end a session without billing
    case 'orders/close-table':
        if ($method !== 'POST') break;
        require_role($staff_user, ['Admin', 'Owner']);
        $input = json_decode(file_get_contents("php://input"), true);
        $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
        $reason = clean_text(isset($input['reason']) ? $input['reason'] : '', 80);
        if ($reason === '') { http_response_code(400); echo json_encode(["status" => "error", "message" => "Enter a reason for closing the table without a bill."]); exit; }
        $active = load_sessions();
        $key = "table_" . $table_no;
        if (!isset($active[$key])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "Table is already free."]); exit; }
        $sess = $active[$key];
        $bill = compute_bill($sess);
        unset($active[$key]);
        write_json("active_orders.json", $active);
        $st = get_settings();
        if ($st['bom_enabled'] && $st['bom_deduct_on'] === 'order' && count($bill['items'])) {
            bom_restock($bill['items'], "Table $table_no closed without bill — $reason", $staff_user);
        }
        write_audit_log($staff_user, "Closed Table $table_no WITHOUT billing (" . count($bill['items']) . " items, ₹" . $bill['total'] . " voided) — $reason");
        echo json_encode(["status" => "ok"]);
        break;

    // 9. POST /api/orders/checkout {table_no, payments[]}
    case 'orders/checkout':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');

            $active = load_sessions();
            $key = "table_" . $table_no;
            if ($table_no === '' || !isset($active[$key])) {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "No active session for Table $table_no"]);
                exit;
            }
            $session = $active[$key];
            $settings = get_settings();
            $bill = compute_bill($session);
            if (count($bill['items']) === 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "This table has no items to bill. Use “Close table” instead."]);
                exit;
            }
            $total = $bill['total'];

            // Payment entry: one or more payments (split bill) that add up to the total
            $allowed_methods = enabled_payment_methods();
            $raw_payments = isset($input['payments']) && is_array($input['payments']) ? $input['payments'] : [];
            if (count($raw_payments) === 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Please record how the bill was paid (" . implode(", ", $allowed_methods) . ")."]);
                exit;
            }
            if (count($raw_payments) > 50) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "A bill can be split into at most 50 payments."]);
                exit;
            }
            $payments = [];
            $paid = 0;
            foreach ($raw_payments as $i => $p) {
                $m = isset($p['method']) ? (string)$p['method'] : '';
                $amt = money(isset($p['amount']) ? $p['amount'] : 0);
                if (!in_array($m, $allowed_methods, true)) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Payment " . ($i + 1) . ": choose a payment method (" . implode(", ", $allowed_methods) . ")."]);
                    exit;
                }
                if ($amt <= 0) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Payment " . ($i + 1) . ": amount must be more than ₹0."]);
                    exit;
                }
                $ref = isset($p['reference']) ? clean_text($p['reference'], 40) : '';
                $label = isset($p['label']) ? clean_text($p['label'], 30) : ('Payment ' . ($i + 1));
                $payments[] = ["label" => $label, "method" => $m, "amount" => $amt, "reference" => $ref];
                $paid += $amt;
            }
            if (abs(money($paid) - $total) > 0.01) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Payments add up to ₹" . money($paid) . " but the bill total is ₹$total. The bill may have changed — please reopen it."]);
                exit;
            }
            $methods_used = array_values(array_unique(array_column($payments, 'method')));
            $payment_mode = count($payments) > 1
                ? "Split (" . count($payments) . ") · " . implode(" + ", $methods_used)
                : $payments[0]['method'];

            $invoices = read_json("invoices.json", []);
            // Random ID for the e-bill link (cannot be guessed); sequential number for tax records
            $invoice_id = "INV-" . time() . "-" . strtoupper(bin2hex(random_bytes(4)));
            $invoice_no = next_invoice_no($invoices, $settings['invoice_prefix']);

            $invoice = array_merge($bill, [
                "invoice_id" => $invoice_id,
                "invoice_no" => $invoice_no,
                "table_no" => $table_no,
                "customer_name" => $session['customer_name'],
                "customer_phone" => $session['customer_phone'],
                "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
                "seller" => [
                    "name" => $settings['business_name'], "address" => $settings['business_address'],
                    "phone" => $settings['business_phone'], "gstin" => $settings['gstin'], "sac" => $settings['sac_code'],
                ],
                "payments" => $payments,
                "payment_mode" => $payment_mode,
                "voids" => $session['voids'],
                "settled_by" => $staff_user
            ]);

            $invoices[] = $invoice;
            write_json("invoices.json", $invoices);
            unset($active[$key]);
            write_json("active_orders.json", $active);
            customer_invoice($session['customer_phone'], $total);

            if ($settings['bom_enabled'] && $settings['bom_deduct_on'] === 'settle') {
                bom_deduct($bill['items'], "Invoice $invoice_no (Table $table_no)", $staff_user);
            }

            $scheme = $is_https ? "https://" : "http://";
            $base_dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
            $sms_sent = read_json("sms_sent.json", []);
            $sms_msg = "Thank You for Visiting " . $settings['business_name'] . ", Here's your e-bill: " . $scheme . $_SERVER['HTTP_HOST'] . $base_dir . "/invoice.html?id=" . $invoice_id;
            $sms_sent[] = ["timestamp" => gmdate("Y-m-d\TH:i:s\Z"), "to" => $session['customer_phone'], "message" => $sms_msg];
            write_json("sms_sent.json", $sms_sent);

            $adj = [];
            if (!$bill['service_charge_on']) $adj[] = "service charge removed";
            if ($bill['discount'] > 0) $adj[] = "discount ₹" . $bill['discount'];
            write_audit_log($staff_user, "Settled Table $table_no — $invoice_no, Total ₹$total, Paid by $payment_mode" . (count($adj) ? " (" . implode(", ", $adj) . ")" : ""));
            if ($session['customer_phone'] !== '') {
                write_audit_log("System", "Sent SMS e-bill to customer (" . mask_phone($session['customer_phone']) . ")");
            }
            echo json_encode(["status" => "ok", "invoice" => $invoice, "sms_message" => $sms_msg]);
        }
        break;

    // 10. GET /api/invoices
    case 'invoices':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $invoices = read_json("invoices.json", []);
            usort($invoices, function($a, $b) {
                return strcmp($b['timestamp'], $a['timestamp']); // newest first
            });
            echo json_encode($invoices);
        }
        break;

    // 11. GET /api/invoice (single)
    case 'invoice':
        if ($method === 'GET') {
            $invoice_id = isset($_GET['id']) ? trim($_GET['id']) : '';
            $invoices = read_json("invoices.json", []);
            foreach ($invoices as $inv) {
                if ($invoice_id !== '' && $inv['invoice_id'] === $invoice_id) {
                    // Public e-bill link: hide most of the phone number
                    if (isset($inv['customer_phone'])) {
                        $inv['customer_phone'] = mask_phone($inv['customer_phone']);
                    }
                    echo json_encode($inv);
                    exit;
                }
            }
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "Invoice not found."]);
        }
        break;

    // 12. GET /api/kitchen/orders
    case 'kitchen/orders':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Kitchen']);
            $active = read_json("active_orders.json", []);
            $flat = [];
            foreach ($active as $table_key => $table_data) {
                if (!is_array($table_data)) continue;
                foreach ($table_data['orders'] as $idx => $order) {
                    $flat[] = [
                        "order_id" => $order['order_id'],
                        "table_no" => isset($table_data['table_no']) ? $table_data['table_no'] : str_replace("table_", "", $table_key),
                        "customer_name" => isset($table_data['customer_name']) ? $table_data['customer_name'] : 'Guest',
                        "round" => $idx + 1,
                        "timestamp" => $order['timestamp'],
                        "completed_at" => isset($order['completed_at']) ? $order['completed_at'] : null,
                        "status" => isset($order['status']) ? $order['status'] : 'Received',
                        "items" => isset($order['items']) ? $order['items'] : []
                    ];
                }
            }
            usort($flat, function($a, $b) {
                return strcmp($a['timestamp'], $b['timestamp']); // oldest first
            });
            echo json_encode($flat);
        }
        break;

    // 13. POST /api/kitchen/update-status
    case 'kitchen/update-status':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Kitchen']);
            $input = json_decode(file_get_contents("php://input"), true);
            $order_id = isset($input['order_id']) ? $input['order_id'] : '';
            $table_no = isset($input['table_no']) ? $input['table_no'] : '';
            $new_status = isset($input['status']) ? $input['status'] : '';
            
            $active = read_json("active_orders.json", []);
            $key = "table_" . $table_no;
            $updated = false;
            
            if (isset($active[$key])) {
                foreach ($active[$key]['orders'] as &$o) {
                    if ($o['order_id'] === $order_id) {
                        $o['status'] = $new_status;
                        if ($new_status === 'Served') {
                            $o['completed_at'] = date("Y-m-d\TH:i:s\Z");
                        }
                        $updated = true;
                        break;
                    }
                }
            }
            
            if ($updated) {
                write_json("active_orders.json", $active);
                write_audit_log($staff_user, "Kitchen updated order $order_id (Table $table_no) → $new_status");
                echo json_encode(["status" => "ok", "message" => "Status updated to $new_status"]);
            } else {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "Order not found."]);
            }
        }
        break;

    // 14. GET /api/kitchen/stats
    case 'kitchen/stats':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Kitchen']);
            $active = read_json("active_orders.json", []);
            $all_rounds = [];
            foreach ($active as $td) {
                if (is_array($td)) {
                    $all_rounds = array_merge($all_rounds, $td['orders']);
                }
            }
            
            $received = 0; $preparing = 0; $ready = 0; $served = 0;
            $longest_min = 0;
            $now = time();
            
            foreach ($all_rounds as $o) {
                $status = isset($o['status']) ? $o['status'] : 'Received';
                if ($status === 'Received') $received++;
                elseif ($status === 'Preparing') $preparing++;
                elseif ($status === 'Ready') $ready++;
                elseif ($status === 'Served') $served++;
                
                if ($status !== 'Served') {
                    $created = strtotime($o['timestamp']);
                    $diff_min = ($now - $created) / 60;
                    if ($diff_min > $longest_min) {
                        $longest_min = $diff_min;
                    }
                }
            }
            
            echo json_encode([
                "received" => $received,
                "preparing" => $preparing,
                "ready" => $ready,
                "served" => $served,
                "longest_min" => round($longest_min, 1)
            ]);
        }
        break;

    // 15. GET /api/dashboard/summary
    case 'dashboard/summary':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $invoices = read_json("invoices.json", []);
            $today_str = date("Y-m-d");
            
            $today_inv = [];
            foreach ($invoices as $i) {
                if (strpos($i['timestamp'], $today_str) === 0) {
                    $today_inv[] = $i;
                }
            }
            
            $today_revenue = array_sum(array_column($today_inv, 'total'));
            
            // Monthly revenue (last 30 days)
            $cutoff = time() - (30 * 86400);
            $monthly_revenue = 0;
            foreach ($invoices as $i) {
                if (strtotime($i['timestamp']) >= $cutoff) {
                    $monthly_revenue += $i['total'];
                }
            }
            
            $avg_bill = count($invoices) > 0 ? array_sum(array_column($invoices, 'total')) / count($invoices) : 0;
            $active_tables = count(read_json("active_orders.json", []));
            
            // Pending orders count
            $active = read_json("active_orders.json", []);
            $pending = 0;
            foreach ($active as $td) {
                if (is_array($td)) {
                    foreach ($td['orders'] as $o) {
                        if (in_array(isset($o['status']) ? $o['status'] : 'Received', ['Received', 'Preparing'])) {
                            $pending++;
                        }
                    }
                }
            }
            
            echo json_encode([
                "today_revenue" => round($today_revenue, 2),
                "today_invoices" => count($today_inv),
                "active_tables" => $active_tables,
                "avg_bill" => round($avg_bill, 2),
                "monthly_revenue" => round($monthly_revenue, 2),
                "pending_orders" => $pending,
                "bom_enabled" => get_settings()['bom_enabled'],
                "low_stock_count" => count(array_filter(read_json("inventory.json", ["materials" => []])['materials'], function($m) {
                    return floatval($m['stock']) <= floatval($m['reorder_level']);
                }))
            ]);
        }
        break;

    // 16. GET /api/dashboard/revenue
    case 'dashboard/revenue':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $invoices = read_json("invoices.json", []);
            $result = [];
            for ($i = 29; $i >= 0; $i--) {
                $day = date("Y-m-d", time() - ($i * 86400));
                $day_label = date("d M", time() - ($i * 86400));
                $rev = 0;
                foreach ($invoices as $inv) {
                    if (strpos($inv['timestamp'], $day) === 0) {
                        $rev += $inv['total'];
                    }
                }
                $result[] = ["date" => $day_label, "revenue" => round($rev, 2)];
            }
            echo json_encode($result);
        }
        break;

    // 17. GET /api/dashboard/items
    case 'dashboard/items':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $invoices = read_json("invoices.json", []);
            $item_map = [];
            foreach ($invoices as $inv) {
                foreach ($inv['items'] as $item) {
                    $name = $item['name'];
                    $qty = isset($item['quantity']) ? intval($item['quantity']) : 1;
                    $price = isset($item['price']) ? floatval($item['price']) : 0;
                    if (!isset($item_map[$name])) {
                        $item_map[$name] = ["name" => $name, "qty" => 0, "revenue" => 0];
                    }
                    $item_map[$name]['qty'] += $qty;
                    $item_map[$name]['revenue'] += $qty * $price;
                }
            }
            usort($item_map, function($a, $b) {
                return $b['qty'] - $a['qty']; // highest sold first
            });
            echo json_encode(array_slice($item_map, 0, 20));
        }
        break;

    // 18. GET /api/dashboard/categories
    case 'dashboard/categories':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $invoices = read_json("invoices.json", []);
            
            // Map item name to category
            $menu_items = [];
            if (true) {
                $md = read_json("menu_data.json", []);
                $categories = [];
                if (isset($md['categories'])) {
                    foreach ($md['categories'] as $c) {
                        $categories[$c['id']] = $c['name'];
                    }
                }
                if (isset($md['items'])) {
                    foreach ($md['items'] as $item) {
                        $cat_id = isset($item['category_id']) ? $item['category_id'] : '';
                        $menu_items[$item['name']] = isset($categories[$cat_id]) ? $categories[$cat_id] : 'Other';
                    }
                }
            }
            
            $cat_map = [];
            foreach ($invoices as $inv) {
                foreach ($inv['items'] as $item) {
                    $name = $item['name'];
                    $cat = isset($menu_items[$name]) ? $menu_items[$name] : 'Other';
                    $qty = isset($item['quantity']) ? intval($item['quantity']) : 1;
                    $price = isset($item['price']) ? floatval($item['price']) : 0;
                    $cat_map[$cat] = (isset($cat_map[$cat]) ? $cat_map[$cat] : 0) + ($qty * $price);
                }
            }
            
            $result = [];
            foreach ($cat_map as $k => $v) {
                $result[] = ["category" => $k, "revenue" => round($v, 2)];
            }
            usort($result, function($a, $b) {
                return $b['revenue'] > $a['revenue'] ? 1 : -1;
            });
            echo json_encode($result);
        }
        break;

    // 19. GET /api/dashboard/hourly
    case 'dashboard/hourly':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner']);
            $invoices = read_json("invoices.json", []);
            $hour_map = array_fill(0, 24, 0);
            foreach ($invoices as $inv) {
                $ts = strtotime($inv['timestamp']);
                // Convert UTC to IST (+5:30)
                $ist_ts = $ts + (5.5 * 3600);
                $hour = intval(date("H", $ist_ts));
                $hour_map[$hour]++;
            }
            $result = [];
            for ($h = 10; $h < 24; $h++) {
                $result[] = ["hour" => sprintf("%02d:00", $h), "orders" => $hour_map[$h]];
            }
            echo json_encode($result);
        }
        break;

    // 21. GET/POST /api/settings (Admin only)
    case 'settings':
        require_role($staff_user, ['Admin']);
        if ($method === 'GET') {
            echo json_encode(get_settings());
        } elseif ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            if (!is_array($input)) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Invalid settings."]);
                exit;
            }
            $old = get_settings();
            $new = $old;
            if (isset($input['business_name']))    $new['business_name']    = clean_text($input['business_name'], 80) ?: $old['business_name'];
            if (isset($input['business_address'])) $new['business_address'] = clean_text($input['business_address'], 160);
            if (isset($input['business_phone']))   $new['business_phone']   = clean_text($input['business_phone'], 20);
            if (isset($input['gstin']))            $new['gstin']            = strtoupper(clean_text($input['gstin'], 20));
            if (isset($input['tables_count']))     $new['tables_count']     = max(1, min(200, intval($input['tables_count'])));
            if (isset($input['payment_methods']) && is_array($input['payment_methods'])) {
                foreach (array_keys(default_settings()['payment_methods']) as $m) {
                    if (isset($input['payment_methods'][$m])) $new['payment_methods'][$m] = (bool)$input['payment_methods'][$m];
                }
                if (!in_array(true, $new['payment_methods'], true)) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Keep at least one payment method turned on."]);
                    exit;
                }
            }
            if (isset($input['bom_enabled']))        $new['bom_enabled']        = (bool)$input['bom_enabled'];
            if (isset($input['bom_deduct_on']))      $new['bom_deduct_on']      = $input['bom_deduct_on'] === 'settle' ? 'settle' : 'order';
            if (isset($input['block_on_low_stock'])) $new['block_on_low_stock'] = (bool)$input['block_on_low_stock'];
            if (isset($input['service_charge_percent'])) $new['service_charge_percent'] = max(0, min(20, round(floatval($input['service_charge_percent']), 2)));
            if (isset($input['gst_percent']))        $new['gst_percent']        = max(0, min(28, round(floatval($input['gst_percent']), 2)));
            if (isset($input['liquor_vat_percent'])) $new['liquor_vat_percent'] = max(0, min(60, round(floatval($input['liquor_vat_percent']), 2)));
            if (isset($input['invoice_prefix']))     $new['invoice_prefix']     = substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string)$input['invoice_prefix'])), 0, 4) ?: 'INV';
            if (isset($input['sac_code']))           $new['sac_code']           = substr(preg_replace('/\D/', '', (string)$input['sac_code']), 0, 8);
            if (isset($input['upi_id'])) {
                $upi = strtolower(trim((string)$input['upi_id']));
                if ($upi !== '' && !preg_match('/^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9]{2,64}$/', $upi)) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "That UPI ID doesn't look right. It should look like name@bank, e.g. downtownluka@okhdfcbank."]);
                    exit;
                }
                $new['upi_id'] = $upi;
            }
            if (isset($input['upi_name']))           $new['upi_name']           = clean_text($input['upi_name'], 50);
            write_json("settings.json", $new);

            // Describe what changed for the audit log
            $changes = [];
            foreach ($new as $k => $v) {
                if ($old[$k] !== $v) {
                    if ($k === 'bom_enabled') $changes[] = "BOM & Inventory " . ($v ? "enabled" : "disabled");
                    elseif ($k === 'payment_methods') {
                        foreach ($v as $m => $on) if ($old[$k][$m] !== $on) $changes[] = "$m payments " . ($on ? "enabled" : "disabled");
                    } else $changes[] = str_replace('_', ' ', $k) . " → " . (is_bool($v) ? ($v ? 'on' : 'off') : $v);
                }
            }
            write_audit_log($staff_user, "Updated Settings" . (count($changes) ? ": " . implode("; ", $changes) : " (no changes)"));
            echo json_encode(["status" => "ok", "settings" => $new]);
        }
        break;

    // 22. GET /api/settings/public — safe subset for pages and staff of all roles
    case 'settings/public':
        $s = get_settings();
        echo json_encode([
            "business_name"    => $s['business_name'],
            "business_address" => $s['business_address'],
            "business_phone"   => $s['business_phone'],
            "gstin"            => $s['gstin'],
            "tables_count"     => $s['tables_count'],
            "payment_methods"  => enabled_payment_methods(),
            "bom_enabled"      => $s['bom_enabled'],
            "service_charge_percent" => $s['service_charge_percent'],
            "gst_percent"      => $s['gst_percent'],
            "liquor_vat_percent" => $s['liquor_vat_percent'],
            "sac_code"         => $s['sac_code'],
            "upi_id"           => $s['upi_id'],
            "upi_name"         => $s['upi_name'] !== '' ? $s['upi_name'] : $s['business_name'],
        ]);
        break;

    // 23. GET/POST /api/inventory — raw materials
    case 'inventory':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            echo json_encode(read_json("inventory.json", ["materials" => []]));
        } elseif ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $action = isset($input['action']) ? $input['action'] : '';
            // Receptionists may record stock received; only Admin/Owner edit the material list
            require_role($staff_user, $action === 'adjust' ? ['Admin', 'Owner', 'Receptionist'] : ['Admin', 'Owner']);
            $inv = read_json("inventory.json", ["materials" => []]);
            $valid_units = ['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'bottle', 'dozen'];

            if ($action === 'save') {
                $m = isset($input['material']) && is_array($input['material']) ? $input['material'] : [];
                $name = clean_text(isset($m['name']) ? $m['name'] : '', 60);
                $unit = isset($m['unit']) && in_array($m['unit'], $valid_units, true) ? $m['unit'] : 'pcs';
                if ($name === '') {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Material name is required."]);
                    exit;
                }
                $fields = [
                    "name" => $name,
                    "unit" => $unit,
                    "reorder_level" => max(0, round(floatval(isset($m['reorder_level']) ? $m['reorder_level'] : 0), 3)),
                    "cost_per_unit" => max(0, money(isset($m['cost_per_unit']) ? $m['cost_per_unit'] : 0)),
                ];
                $id = isset($m['id']) ? (string)$m['id'] : '';
                $found = false;
                foreach ($inv['materials'] as &$row) {
                    if ($id !== '' && $row['id'] === $id) { $row = array_merge($row, $fields); $found = true; break; }
                }
                unset($row);
                if (!$found) {
                    $opening = max(0, round(floatval(isset($m['stock']) ? $m['stock'] : 0), 3));
                    $id = "mat-" . time() . "-" . bin2hex(random_bytes(3));
                    $inv['materials'][] = array_merge(["id" => $id, "stock" => $opening], $fields);
                    if ($opening > 0) {
                        add_ledger_entries([["timestamp" => gmdate("Y-m-d\TH:i:s\Z"), "material_id" => $id, "name" => $name,
                            "delta" => $opening, "balance" => $opening, "reason" => "Opening stock", "user" => $staff_user]]);
                    }
                }
                write_json("inventory.json", $inv);
                write_audit_log($staff_user, ($found ? "Updated" : "Added") . " raw material: \"$name\"");
                echo json_encode(["status" => "ok", "id" => $id]);

            } elseif ($action === 'delete') {
                $id = isset($input['id']) ? (string)$input['id'] : '';
                $bom = read_json("bom.json", []);
                foreach ($bom as $item_id => $variants) {
                    foreach ($variants as $ings) {
                        foreach ($ings as $ing) {
                            if ($ing['material_id'] === $id) {
                                http_response_code(400);
                                echo json_encode(["status" => "error", "message" => "This material is used in a recipe. Remove it from the recipe first."]);
                                exit;
                            }
                        }
                    }
                }
                foreach (read_json("purchase_orders.json", []) as $po) {
                    if (in_array($po['status'], ['Draft', 'Ordered', 'Partially Received'], true)) {
                        foreach ($po['lines'] as $l) {
                            if ($l['material_id'] === $id) {
                                http_response_code(400);
                                echo json_encode(["status" => "error", "message" => "This material is on open purchase order " . $po['po_number'] . "."]);
                                exit;
                            }
                        }
                    }
                }
                $name = $id;
                $inv['materials'] = array_values(array_filter($inv['materials'], function($row) use ($id, &$name) {
                    if ($row['id'] === $id) { $name = $row['name']; return false; }
                    return true;
                }));
                write_json("inventory.json", $inv);
                write_audit_log($staff_user, "Deleted raw material: \"$name\"");
                echo json_encode(["status" => "ok"]);

            } elseif ($action === 'adjust') {
                // Stock in (purchase), wastage, or correction after a stock count
                $id = isset($input['id']) ? (string)$input['id'] : '';
                $delta = round(floatval(isset($input['delta']) ? $input['delta'] : 0), 3);
                $note = clean_text(isset($input['note']) ? $input['note'] : '', 80);
                if ($delta == 0) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Enter a quantity to add or remove."]);
                    exit;
                }
                $done = null;
                foreach ($inv['materials'] as &$row) {
                    if ($row['id'] === $id) {
                        $row['stock'] = round(floatval($row['stock']) + $delta, 3);
                        $done = $row;
                        break;
                    }
                }
                unset($row);
                if ($done === null) {
                    http_response_code(404);
                    echo json_encode(["status" => "error", "message" => "Material not found."]);
                    exit;
                }
                write_json("inventory.json", $inv);
                $reason = ($delta > 0 ? "Stock in" : "Stock out") . ($note !== '' ? " — $note" : "");
                add_ledger_entries([["timestamp" => gmdate("Y-m-d\TH:i:s\Z"), "material_id" => $id, "name" => $done['name'],
                    "delta" => $delta, "balance" => $done['stock'], "reason" => $reason, "user" => $staff_user]]);
                write_audit_log($staff_user, "Stock adjusted: " . $done['name'] . " " . ($delta > 0 ? "+" : "") . $delta . " " . $done['unit'] . ($note !== '' ? " ($note)" : ""));
                echo json_encode(["status" => "ok", "stock" => $done['stock']]);

            } else {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Unknown inventory action."]);
            }
        }
        break;

    // 24. GET /api/inventory/ledger — latest stock movements
    case 'inventory/ledger':
        require_bom_enabled();
        require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
        $ledger = array_reverse(read_json("stock_ledger.json", []));
        echo json_encode(array_slice($ledger, 0, 300));
        break;

    // 25. GET/POST /api/bom — recipes linking menu items to raw materials
    case 'bom':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            echo json_encode((object)read_json("bom.json", []));
        } elseif ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner']);
            $input = json_decode(file_get_contents("php://input"), true);
            $item_id = isset($input['item_id']) ? (string)$input['item_id'] : '';
            $variant = isset($input['variant']) ? (string)$input['variant'] : '';
            $menu_item = lookup_menu_item_any($item_id);
            if ($menu_item === null) {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "Menu item not found."]);
                exit;
            }
            $variant_labels = array_column(isset($menu_item['price_variants']) ? $menu_item['price_variants'] : [], 'label');
            if (!in_array($variant, $variant_labels, true)) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Unknown size/variant for this item."]);
                exit;
            }
            $inv = read_json("inventory.json", ["materials" => []]);
            $material_ids = array_column($inv['materials'], 'id');
            $ings = [];
            $raw = isset($input['ingredients']) && is_array($input['ingredients']) ? $input['ingredients'] : [];
            foreach ($raw as $ing) {
                $mid = isset($ing['material_id']) ? (string)$ing['material_id'] : '';
                $qty = round(floatval(isset($ing['qty']) ? $ing['qty'] : 0), 4);
                if (!in_array($mid, $material_ids, true) || $qty <= 0) continue;
                $ings[] = ["material_id" => $mid, "qty" => $qty];
            }
            $bom = read_json("bom.json", []);
            if (count($ings) === 0) {
                unset($bom[$item_id][$variant]);
                if (isset($bom[$item_id]) && count($bom[$item_id]) === 0) unset($bom[$item_id]);
            } else {
                $bom[$item_id][$variant] = $ings;
            }
            write_json("bom.json", (object)$bom);
            write_audit_log($staff_user, "Updated recipe (BOM) for \"" . $menu_item['name'] . "\" — $variant (" . count($ings) . " ingredients)");
            echo json_encode(["status" => "ok"]);
        }
        break;

    // 27. GET/POST /api/suppliers — vendor master for purchasing
    case 'suppliers':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            echo json_encode(read_json("suppliers.json", []));
        } elseif ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner']);
            $input = json_decode(file_get_contents("php://input"), true);
            $action = isset($input['action']) ? $input['action'] : '';
            $suppliers = read_json("suppliers.json", []);
            if ($action === 'save') {
                $sup = isset($input['supplier']) && is_array($input['supplier']) ? $input['supplier'] : [];
                $name = clean_text(isset($sup['name']) ? $sup['name'] : '', 80);
                if ($name === '') {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "Supplier name is required."]);
                    exit;
                }
                $fields = [
                    "name"    => $name,
                    "contact" => clean_text(isset($sup['contact']) ? $sup['contact'] : '', 60),
                    "phone"   => clean_text(isset($sup['phone']) ? $sup['phone'] : '', 20),
                    "email"   => filter_var(isset($sup['email']) ? trim($sup['email']) : '', FILTER_VALIDATE_EMAIL) ?: '',
                    "gstin"   => strtoupper(clean_text(isset($sup['gstin']) ? $sup['gstin'] : '', 20)),
                    "address" => clean_text(isset($sup['address']) ? $sup['address'] : '', 200),
                ];
                $id = isset($sup['id']) ? (string)$sup['id'] : '';
                $found = false;
                foreach ($suppliers as &$row) {
                    if ($id !== '' && $row['id'] === $id) { $row = array_merge($row, $fields); $found = true; break; }
                }
                unset($row);
                if (!$found) {
                    $id = "sup-" . time() . "-" . bin2hex(random_bytes(3));
                    $suppliers[] = array_merge(["id" => $id], $fields);
                }
                write_json("suppliers.json", $suppliers);
                write_audit_log($staff_user, ($found ? "Updated" : "Added") . " supplier: \"$name\"");
                echo json_encode(["status" => "ok", "id" => $id]);
            } elseif ($action === 'delete') {
                $id = isset($input['id']) ? (string)$input['id'] : '';
                foreach (read_json("purchase_orders.json", []) as $po) {
                    if ($po['supplier_id'] === $id && in_array($po['status'], ['Draft', 'Ordered', 'Partially Received'], true)) {
                        http_response_code(400);
                        echo json_encode(["status" => "error", "message" => "This supplier has open purchase orders (" . $po['po_number'] . "). Close or cancel them first."]);
                        exit;
                    }
                }
                $name = $id;
                $suppliers = array_values(array_filter($suppliers, function($r) use ($id, &$name) {
                    if ($r['id'] === $id) { $name = $r['name']; return false; }
                    return true;
                }));
                write_json("suppliers.json", $suppliers);
                write_audit_log($staff_user, "Deleted supplier: \"$name\"");
                echo json_encode(["status" => "ok"]);
            } else {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Unknown supplier action."]);
            }
        }
        break;

    // 28. GET/POST /api/purchase-orders — Draft → Ordered → (Partially) Received, or Cancelled
    case 'purchase-orders':
        require_bom_enabled();
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $pos = read_json("purchase_orders.json", []);
            usort($pos, function($a, $b) { return strcmp($b['created_at'], $a['created_at']); });
            echo json_encode($pos);
            break;
        }
        if ($method !== 'POST') break;

        $input = json_decode(file_get_contents("php://input"), true);
        $action = isset($input['action']) ? $input['action'] : '';
        // Receptionists can record deliveries; everything else is Admin / Owner
        require_role($staff_user, $action === 'receive' ? ['Admin', 'Owner', 'Receptionist'] : ['Admin', 'Owner']);

        $pos = read_json("purchase_orders.json", []);
        $now = gmdate("Y-m-d\TH:i:s\Z");
        $find = function($id) use (&$pos) {
            foreach ($pos as $i => $po) if ($po['id'] === $id) return $i;
            return -1;
        };
        $fail = function($msg, $code = 400) {
            http_response_code($code);
            echo json_encode(["status" => "error", "message" => $msg]);
            exit;
        };

        if ($action === 'save') {
            // Create or edit a Draft
            $data = isset($input['po']) && is_array($input['po']) ? $input['po'] : [];
            $supplier_id = isset($data['supplier_id']) ? (string)$data['supplier_id'] : '';
            $supplier = null;
            foreach (read_json("suppliers.json", []) as $sup) if ($sup['id'] === $supplier_id) $supplier = $sup;
            if ($supplier === null) $fail("Choose a supplier.");

            $materials = [];
            foreach (read_json("inventory.json", ["materials" => []])['materials'] as $m) $materials[$m['id']] = $m;
            $lines = [];
            $seen = [];
            foreach ((isset($data['lines']) && is_array($data['lines']) ? $data['lines'] : []) as $ln) {
                $mid = isset($ln['material_id']) ? (string)$ln['material_id'] : '';
                $qty = round(floatval(isset($ln['qty']) ? $ln['qty'] : 0), 3);
                $rate = money(isset($ln['rate']) ? $ln['rate'] : 0);
                if (!isset($materials[$mid]) || $qty <= 0 || $rate < 0) continue;
                if (isset($seen[$mid])) $fail("\"" . $materials[$mid]['name'] . "\" is listed twice. Combine it into one line.");
                $seen[$mid] = true;
                $lines[] = ["material_id" => $mid, "name" => $materials[$mid]['name'], "unit" => $materials[$mid]['unit'],
                            "qty" => $qty, "rate" => $rate, "received_qty" => 0];
            }
            if (count($lines) === 0) $fail("Add at least one material with a quantity.");
            $tax_pct = max(0, min(28, floatval(isset($data['tax_pct']) ? $data['tax_pct'] : 0)));
            $subtotal = money(array_sum(array_map(function($l) { return $l['qty'] * $l['rate']; }, $lines)));
            $tax = money($subtotal * $tax_pct / 100);
            $expected = isset($data['expected_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['expected_date']) ? $data['expected_date'] : '';
            $notes = clean_text(isset($data['notes']) ? $data['notes'] : '', 300);

            $id = isset($data['id']) ? (string)$data['id'] : '';
            $idx = $id !== '' ? $find($id) : -1;
            if ($idx >= 0) {
                if ($pos[$idx]['status'] !== 'Draft') $fail("Only Draft purchase orders can be edited.");
                $pos[$idx] = array_merge($pos[$idx], [
                    "supplier_id" => $supplier_id, "supplier_name" => $supplier['name'], "lines" => $lines,
                    "tax_pct" => $tax_pct, "subtotal" => $subtotal, "tax" => $tax, "total" => money($subtotal + $tax),
                    "expected_date" => $expected, "notes" => $notes,
                ]);
                $pos[$idx]['history'][] = ["timestamp" => $now, "user" => $staff_user, "action" => "Edited draft"];
                $po = $pos[$idx];
                write_audit_log($staff_user, "Edited purchase order " . $po['po_number']);
            } else {
                // Sequential PO number per month, e.g. PO-202611-0003
                $prefix = "PO-" . gmdate("Ym") . "-";
                $n = 0;
                foreach ($pos as $p) if (strpos($p['po_number'], $prefix) === 0) $n = max($n, intval(substr($p['po_number'], strlen($prefix))));
                $po = [
                    "id" => "po-" . time() . "-" . bin2hex(random_bytes(3)),
                    "po_number" => $prefix . str_pad($n + 1, 4, "0", STR_PAD_LEFT),
                    "status" => "Draft",
                    "supplier_id" => $supplier_id, "supplier_name" => $supplier['name'],
                    "lines" => $lines, "tax_pct" => $tax_pct, "subtotal" => $subtotal, "tax" => $tax, "total" => money($subtotal + $tax),
                    "expected_date" => $expected, "notes" => $notes,
                    "created_by" => $staff_user, "created_at" => $now,
                    "receipts" => [],
                    "history" => [["timestamp" => $now, "user" => $staff_user, "action" => "Created draft"]],
                ];
                $pos[] = $po;
                write_audit_log($staff_user, "Created purchase order " . $po['po_number'] . " for " . $supplier['name'] . " (₹" . $po['total'] . ")");
            }
            write_json("purchase_orders.json", $pos);
            echo json_encode(["status" => "ok", "po" => $po]);

        } elseif ($action === 'place') {
            $idx = $find(isset($input['id']) ? (string)$input['id'] : '');
            if ($idx < 0) $fail("Purchase order not found.", 404);
            if ($pos[$idx]['status'] !== 'Draft') $fail("This purchase order has already been placed.");
            $pos[$idx]['status'] = 'Ordered';
            $pos[$idx]['ordered_at'] = $now;
            $pos[$idx]['history'][] = ["timestamp" => $now, "user" => $staff_user, "action" => "Placed order with supplier"];
            write_json("purchase_orders.json", $pos);
            write_audit_log($staff_user, "Placed purchase order " . $pos[$idx]['po_number'] . " with " . $pos[$idx]['supplier_name']);
            echo json_encode(["status" => "ok", "po" => $pos[$idx]]);

        } elseif ($action === 'receive') {
            // Goods receipt: adds stock, writes the ledger, updates last purchase cost
            $idx = $find(isset($input['id']) ? (string)$input['id'] : '');
            if ($idx < 0) $fail("Purchase order not found.", 404);
            $po = $pos[$idx];
            if (!in_array($po['status'], ['Ordered', 'Partially Received'], true)) $fail("Only placed orders can be received.");
            $bill_no = clean_text(isset($input['bill_no']) ? $input['bill_no'] : '', 40);
            $note = clean_text(isset($input['note']) ? $input['note'] : '', 120);
            $incoming = [];
            foreach ((isset($input['lines']) && is_array($input['lines']) ? $input['lines'] : []) as $ln) {
                $mid = isset($ln['material_id']) ? (string)$ln['material_id'] : '';
                $q = round(floatval(isset($ln['qty']) ? $ln['qty'] : 0), 3);
                if ($mid !== '' && $q > 0) $incoming[$mid] = (isset($incoming[$mid]) ? $incoming[$mid] : 0) + $q;
            }
            if (count($incoming) === 0) $fail("Enter the quantity received for at least one material.");

            $received_lines = [];
            foreach ($po['lines'] as &$line) {
                if (!isset($incoming[$line['material_id']])) continue;
                $q = $incoming[$line['material_id']];
                $pending = round($line['qty'] - $line['received_qty'], 3);
                if ($q > $pending + 0.0005) $fail("\"" . $line['name'] . "\": only " . $pending . " " . $line['unit'] . " is still pending on this order.");
                $line['received_qty'] = round($line['received_qty'] + $q, 3);
                $received_lines[] = ["material_id" => $line['material_id'], "name" => $line['name'], "unit" => $line['unit'], "qty" => $q, "rate" => $line['rate']];
            }
            unset($line);
            if (count($received_lines) === 0) $fail("Those materials are not on this purchase order.");

            // Update inventory
            $inv = read_json("inventory.json", ["materials" => []]);
            $entries = [];
            foreach ($received_lines as $rl) {
                foreach ($inv['materials'] as &$m) {
                    if ($m['id'] !== $rl['material_id']) continue;
                    $m['stock'] = round(floatval($m['stock']) + $rl['qty'], 3);
                    if ($rl['rate'] > 0) $m['cost_per_unit'] = $rl['rate'];   // latest purchase price
                    $entries[] = ["timestamp" => $now, "material_id" => $m['id'], "name" => $m['name'], "delta" => $rl['qty'],
                                  "balance" => $m['stock'], "reason" => "Received on " . $po['po_number'] . ($bill_no !== '' ? " (bill $bill_no)" : ""),
                                  "user" => $staff_user];
                }
                unset($m);
            }
            write_json("inventory.json", $inv);
            add_ledger_entries($entries);

            $all_done = true;
            foreach ($po['lines'] as $l) if ($l['received_qty'] + 0.0005 < $l['qty']) $all_done = false;
            $po['status'] = $all_done ? 'Received' : 'Partially Received';
            $po['receipts'][] = ["timestamp" => $now, "user" => $staff_user, "bill_no" => $bill_no, "note" => $note, "lines" => $received_lines,
                                 "value" => money(array_sum(array_map(function($l) { return $l['qty'] * $l['rate']; }, $received_lines)))];
            $po['history'][] = ["timestamp" => $now, "user" => $staff_user, "action" => ($all_done ? "Received in full" : "Received part delivery") . ($bill_no !== '' ? " · bill $bill_no" : "")];
            if ($all_done) $po['received_at'] = $now;
            $pos[$idx] = $po;
            write_json("purchase_orders.json", $pos);
            $summary = implode(", ", array_map(function($l) { return $l['name'] . " " . $l['qty'] . " " . $l['unit']; }, $received_lines));
            write_audit_log($staff_user, "Received goods on " . $po['po_number'] . ": $summary");
            echo json_encode(["status" => "ok", "po" => $po]);

        } elseif ($action === 'cancel') {
            $idx = $find(isset($input['id']) ? (string)$input['id'] : '');
            if ($idx < 0) $fail("Purchase order not found.", 404);
            $st = $pos[$idx]['status'];
            if ($st === 'Received' || $st === 'Cancelled') $fail("This purchase order is already closed.");
            $reason = clean_text(isset($input['reason']) ? $input['reason'] : '', 120);
            // A part-received order is closed short: received stock stays, the rest is cancelled
            $pos[$idx]['status'] = $st === 'Partially Received' ? 'Closed' : 'Cancelled';
            $pos[$idx]['history'][] = ["timestamp" => $now, "user" => $staff_user,
                "action" => ($st === 'Partially Received' ? "Closed short (rest cancelled)" : "Cancelled") . ($reason !== '' ? " — $reason" : "")];
            write_json("purchase_orders.json", $pos);
            write_audit_log($staff_user, ($st === 'Partially Received' ? "Closed " : "Cancelled ") . "purchase order " . $pos[$idx]['po_number'] . ($reason !== '' ? " ($reason)" : ""));
            echo json_encode(["status" => "ok", "po" => $pos[$idx]]);

        } elseif ($action === 'delete') {
            $idx = $find(isset($input['id']) ? (string)$input['id'] : '');
            if ($idx < 0) $fail("Purchase order not found.", 404);
            if ($pos[$idx]['status'] !== 'Draft') $fail("Only drafts can be deleted. Cancel the order instead.");
            $num = $pos[$idx]['po_number'];
            array_splice($pos, $idx, 1);
            write_json("purchase_orders.json", $pos);
            write_audit_log($staff_user, "Deleted draft purchase order $num");
            echo json_encode(["status" => "ok"]);

        } else {
            $fail("Unknown purchase order action.");
        }
        break;

    // 26a. GET /api/audit-log/verify — check nobody edited or removed entries
    case 'audit-log/verify':
        require_role($staff_user, ['Admin', 'Owner']);
        $log = read_json("audit_log.json", []);
        $checked = 0; $legacy = 0; $broken = null; $prev = null;
        foreach ($log as $i => $e) {
            if (!isset($e['hash'])) { $legacy++; $prev = null; continue; }
            if (audit_entry_hash($e) !== $e['hash'] || ($prev !== null && $e['prev'] !== $prev)) {
                $broken = ["index" => $i, "timestamp" => isset($e['timestamp']) ? $e['timestamp'] : ''];
                break;
            }
            $prev = $e['hash'];
            $checked++;
        }
        echo json_encode(["ok" => $broken === null, "checked" => $checked, "legacy" => $legacy, "broken" => $broken]);
        break;

    // 29. GET /api/customers — customer list (one per mobile number)
    case 'customers':
        if ($method === 'GET') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $c = array_values(load_customers());
            usort($c, function($a, $b) { return strcmp($b['last_seen'], $a['last_seen']); });
            echo json_encode($c);
        } elseif ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $action = isset($input['action']) ? $input['action'] : '';
            $phone = clean_phone(isset($input['phone']) ? $input['phone'] : '');
            $c = load_customers();
            if ($action === 'save') {
                require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
                if (!isset($c[$phone])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "Customer not found."]); exit; }
                $name = clean_text(isset($input['name']) ? $input['name'] : '', 40);
                if (mb_strlen($name) >= 2) $c[$phone]['name'] = $name;
                $c[$phone]['notes'] = clean_text(isset($input['notes']) ? $input['notes'] : '', 300);
                write_json("customers.json", (object)$c);
                write_audit_log($staff_user, "Updated customer " . mask_phone($phone));
                echo json_encode(["status" => "ok", "customer" => $c[$phone]]);
            } elseif ($action === 'delete') {
                // Removes the customer profile (e.g. on request). Tax invoices are kept, as the law requires.
                require_role($staff_user, ['Admin']);
                if (!isset($c[$phone])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "Customer not found."]); exit; }
                unset($c[$phone]);
                write_json("customers.json", (object)$c);
                write_audit_log($staff_user, "Deleted customer profile " . mask_phone($phone));
                echo json_encode(["status" => "ok"]);
            } else {
                http_response_code(400); echo json_encode(["status" => "error", "message" => "Unknown action."]);
            }
        }
        break;

    // 30. GET /api/customers/detail?phone= — profile + past orders
    case 'customers/detail':
        require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
        $phone = clean_phone(isset($_GET['phone']) ? $_GET['phone'] : '');
        $c = load_customers();
        if (!isset($c[$phone])) { http_response_code(404); echo json_encode(["status" => "error", "message" => "Customer not found."]); exit; }
        $mine = array_values(array_filter(read_json("invoices.json", []), function($inv) use ($phone) {
            return clean_phone(isset($inv['customer_phone']) ? $inv['customer_phone'] : '') === $phone;
        }));
        usort($mine, function($a, $b) { return strcmp($b['timestamp'], $a['timestamp']); });
        $fav = [];
        foreach ($mine as $inv) foreach ($inv['items'] as $it) {
            $n = $it['name'];
            if (!isset($fav[$n])) $fav[$n] = ["name" => $n, "qty" => 0];
            $fav[$n]['qty'] += intval($it['quantity']);
        }
        usort($fav, function($a, $b) { return $b['qty'] - $a['qty']; });
        $open = null;
        foreach (load_sessions() as $sess) if ($sess['customer_phone'] === $phone) $open = ["table_no" => $sess['table_no'], "since" => $sess['started_at']];
        echo json_encode(["customer" => $c[$phone], "invoices" => $mine, "favourites" => array_slice($fav, 0, 5), "open_table" => $open]);
        break;

    // 26. GET /api/dashboard/payments — revenue by payment method (last 30 days)
    case 'dashboard/payments':
        require_role($staff_user, ['Admin', 'Owner']);
        $invoices = read_json("invoices.json", []);
        $cutoff = time() - (30 * 86400);
        $by = [];
        foreach ($invoices as $inv) {
            if (strtotime($inv['timestamp']) < $cutoff) continue;
            $pays = isset($inv['payments']) && is_array($inv['payments']) && count($inv['payments'])
                ? $inv['payments']
                : [["method" => "Not recorded", "amount" => $inv['total']]];
            foreach ($pays as $p) {
                $m = $p['method'];
                if (!isset($by[$m])) $by[$m] = ["method" => $m, "amount" => 0, "count" => 0];
                $by[$m]['amount'] = money($by[$m]['amount'] + $p['amount']);
                $by[$m]['count']++;
            }
        }
        usort($by, function($a, $b) { return $b['amount'] <=> $a['amount']; });
        echo json_encode(array_values($by));
        break;

    // 20. POST /api/log-error
    case 'log-error':
        if ($method === 'POST') {
            // Cap the size and keep the log from growing without limit
            $input = substr(file_get_contents("php://input"), 0, 4000);
            $logf = data_dir() . "/client_errors.log";
            if (!file_exists($logf) || filesize($logf) < 5 * 1024 * 1024) {
                file_put_contents($logf, "[" . date("Y-m-d H:i:s") . "] " . str_replace(["\r", "\n"], " ", $input) . "\n", FILE_APPEND | LOCK_EX);
            }
            echo json_encode(["status" => "ok"]);
        }
        break;

    default:
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Endpoint '$route' not found."]);
        break;
}
