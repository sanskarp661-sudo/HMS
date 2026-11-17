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
function read_json($filename, $default = []) {
    if (!file_exists($filename)) {
        return $default;
    }
    $content = file_get_contents($filename);
    $data = json_decode($content, true);
    return is_array($data) ? $data : $default;
}

function write_json($filename, $data) {
    file_put_contents($filename, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
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

function write_audit_log($user, $action) {
    $log = read_json("audit_log.json", []);
    $log[] = [
        "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
        "user" => ($user === null || $user === '') ? 'System' : $user,
        "action" => $action
    ];
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
function bom_deduct($items, $reason, $user) {
    $need = bom_requirements($items);
    if (count($need) === 0) return;
    $inv = read_json("inventory.json", ["materials" => []]);
    $entries = [];
    foreach ($inv['materials'] as &$m) {
        if (!isset($need[$m['id']])) continue;
        $m['stock'] = round(floatval($m['stock']) - $need[$m['id']], 3);
        $entries[] = [
            "timestamp"   => gmdate("Y-m-d\TH:i:s\Z"),
            "material_id" => $m['id'],
            "name"        => $m['name'],
            "delta"       => -round($need[$m['id']], 3),
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

// ─── API Endpoint Router ────────────────────────────────────────────────────
switch ($route) {
    
    // 1. GET/POST /api/menu
    case 'menu':
        if ($method === 'GET') {
            echo file_exists("menu_data.json") ? file_get_contents("menu_data.json") : json_encode(["categories" => [], "items" => []]);
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
                $target = 'uploads/' . $filename;
                if (move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
                    echo json_encode(["status" => "success", "url" => $target]);
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

    // 6. GET/POST /api/orders
    case 'orders':
        if ($method === 'GET') {
            $active = read_json("active_orders.json", []);
            if (get_user_role($staff_user) !== null) {
                // Logged-in staff see every table
                echo json_encode((object)$active);
            } else {
                // Customers only see their own table, without guest details
                $table_no = clean_table_no(isset($_GET['table']) ? $_GET['table'] : '');
                $key = "table_" . $table_no;
                $out = [];
                if ($table_no !== '' && isset($active[$key])) {
                    $out[$key] = [
                        "table_no" => $active[$key]['table_no'],
                        "status"   => $active[$key]['status'],
                        "orders"   => $active[$key]['orders'],
                    ];
                }
                echo json_encode((object)$out);
            }
        } elseif ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
            if ($table_no === '') {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Missing table number."]);
                exit;
            }

            // Rebuild the order from the menu: names and prices come from
            // menu_data.json, never from the customer's browser.
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

            // BOM: optionally refuse the order if raw materials are short
            $settings = get_settings();
            if ($settings['bom_enabled'] && $settings['block_on_low_stock']) {
                $short = bom_shortages(bom_requirements($items));
                if (count($short) > 0) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "Sorry, some items are out of stock right now (" . implode(", ", $short) . "). Please ask our staff."]);
                    exit;
                }
            }

            $active = read_json("active_orders.json", []);
            $key = "table_" . $table_no;

            if (!isset($active[$key])) {
                $name = clean_text(isset($input['customer_name']) ? $input['customer_name'] : '');
                $active[$key] = [
                    "table_no" => $table_no,
                    "session_id" => "sess_" . time(),
                    "customer_name" => $name !== '' ? $name : 'Guest',
                    "customer_phone" => clean_phone(isset($input['customer_phone']) ? $input['customer_phone'] : ''),
                    "status" => "Active",
                    "orders" => []
                ];
            }

            // Add new order round
            $order_id = "ord_" . time() . rand(100, 999);
            $active[$key]['orders'][] = [
                "order_id" => $order_id,
                "timestamp" => date("Y-m-d\TH:i:s\Z"),
                "status" => "Received",
                "items" => $items
            ];
            
            write_json("active_orders.json", $active);
            write_audit_log("Customer", "Placed order round for Table " . $table_no);
            if ($settings['bom_enabled'] && $settings['bom_deduct_on'] === 'order') {
                bom_deduct($items, "Order $order_id (Table $table_no)", "Customer");
            }
            echo json_encode(["status" => "ok", "message" => "Order round placed.", "order_id" => $order_id]);
        }
        break;

    // 7. POST /api/orders/update-status
    case 'orders/update-status':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist', 'Waiter']);
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
                write_audit_log($staff_user, "Updated Table $table_no order $order_id status to $new_status");
                echo json_encode(["status" => "ok"]);
            } else {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "Order not found."]);
            }
        }
        break;

    // 8. POST /api/orders/request-checkout
    case 'orders/request-checkout':
        if ($method === 'POST') {
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');

            $active = read_json("active_orders.json", []);
            $key = "table_" . $table_no;

            if ($table_no !== '' && isset($active[$key])) {
                $active[$key]['status'] = 'Checkout Requested';
                write_json("active_orders.json", $active);
                write_audit_log("Customer", "Table $table_no requested final bill settlement");
                echo json_encode(["status" => "ok"]);
            } else {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "Table session not found."]);
            }
        }
        break;

    // 9. POST /api/orders/checkout
    case 'orders/checkout':
        if ($method === 'POST') {
            require_role($staff_user, ['Admin', 'Owner', 'Receptionist']);
            $input = json_decode(file_get_contents("php://input"), true);
            $table_no = clean_table_no(isset($input['table_no']) ? $input['table_no'] : '');
            
            $active = read_json("active_orders.json", []);
            $key = "table_" . $table_no;
            
            if ($table_no === '' || !isset($active[$key])) {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "No active session for Table $table_no"]);
                exit;
            }
            
            $session = $active[$key];
            $settings = get_settings();
            
            // Consolidate items
            $bill_items = [];
            $subtotal = 0;
            foreach ($session['orders'] as $ord) {
                foreach ($ord['items'] as $it) {
                    $variant = isset($it['variant']) ? $it['variant'] : 'Portion';
                    $item_key = (isset($it['id']) ? $it['id'] : $it['name']) . '||' . $variant;
                    if (!isset($bill_items[$item_key])) {
                        $bill_items[$item_key] = [
                            "id" => isset($it['id']) ? $it['id'] : '',
                            "name" => $it['name'],
                            "variant" => $variant,
                            "price" => floatval($it['price']),
                            "quantity" => 0
                        ];
                    }
                    $bill_items[$item_key]['quantity'] += intval($it['quantity']);
                    $subtotal += floatval($it['price']) * intval($it['quantity']);
                }
            }
            
            $subtotal = money($subtotal);
            $svc_charge = money($subtotal * 0.10);
            $tax = money($subtotal * 0.05);
            $total = money($subtotal + $svc_charge + $tax);

            // ── Payment entry: one or more payments (split bill) ──
            // Each payment = { method: "UPI" | "Cash" | "Card", amount }
            // and together they must add up to the bill total.
            $allowed_methods = enabled_payment_methods();
            $raw_payments = isset($input['payments']) && is_array($input['payments']) ? $input['payments'] : [];
            if (count($raw_payments) === 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Please record how the bill was paid (UPI, Cash or Card)."]);
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
                echo json_encode(["status" => "error", "message" => "Payments add up to ₹" . money($paid) . " but the bill total is ₹$total."]);
                exit;
            }
            $methods_used = array_values(array_unique(array_column($payments, 'method')));
            $payment_mode = count($payments) > 1
                ? "Split (" . count($payments) . ") · " . implode(" + ", $methods_used)
                : $payments[0]['method'];

            // Unguessable ID, so people cannot browse other customers' bills
            $invoice_id = "INV-" . time() . "-" . strtoupper(bin2hex(random_bytes(4)));
            
            $invoice = [
                "invoice_id" => $invoice_id,
                "table_no" => $table_no,
                "customer_name" => $session['customer_name'],
                "customer_phone" => $session['customer_phone'],
                "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
                "subtotal" => $subtotal,
                "service_charge" => $svc_charge,
                "tax" => $tax,
                "total" => $total,
                "items" => array_values($bill_items),
                "payments" => $payments,
                "payment_mode" => $payment_mode,
                "settled_by" => $staff_user
            ];
            
            // Save invoice
            $invoices = read_json("invoices.json", []);
            $invoices[] = $invoice;
            write_json("invoices.json", $invoices);
            
            // Delete active table
            unset($active[$key]);
            write_json("active_orders.json", $active);

            // BOM: deduct stock now if configured to do it at settlement
            if ($settings['bom_enabled'] && $settings['bom_deduct_on'] === 'settle') {
                bom_deduct(array_values($bill_items), "Invoice $invoice_id (Table $table_no)", $staff_user);
            }
            
            // Mock SMS sending log
            $scheme = $is_https ? "https://" : "http://";
            $base_dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
            $sms_sent = read_json("sms_sent.json", []);
            $sms_msg = "Thank You for Visiting " . $settings['business_name'] . ", Here's your e-bill: " . $scheme . $_SERVER['HTTP_HOST'] . $base_dir . "/invoice.html?id=" . $invoice_id;
            $sms_sent[] = [
                "timestamp" => gmdate("Y-m-d\TH:i:s\Z"),
                "to" => $session['customer_phone'],
                "message" => $sms_msg
            ];
            write_json("sms_sent.json", $sms_sent);
            
            write_audit_log($staff_user, "Settled Table $table_no — Invoice $invoice_id, Total ₹$total, Paid by $payment_mode");
            if ($session['customer_phone'] !== '') {
                write_audit_log("System", "Sent SMS e-bill to customer (" . mask_phone($session['customer_phone']) . ")");
            }
            
            echo json_encode([
                "status" => "ok",
                "invoice" => $invoice,
                "sms_message" => $sms_msg
            ]);
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
            if (file_exists("menu_data.json")) {
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
            if (!file_exists("client_errors.log") || filesize("client_errors.log") < 5 * 1024 * 1024) {
                file_put_contents("client_errors.log", "[" . date("Y-m-d H:i:s") . "] " . str_replace(["\r", "\n"], " ", $input) . "\n", FILE_APPEND | LOCK_EX);
            }
            echo json_encode(["status" => "ok"]);
        }
        break;

    default:
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Endpoint '$route' not found."]);
        break;
}
