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
        "timestamp" => date("Y-m-d\TH:i:s\Z"),
        "user" => $user,
        "action" => $action
    ];
    write_json("audit_log.json", $log);
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
            write_audit_log($staff_user, "Modified Menu Catalog");
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
            usort($log, function($a, $b) {
                return strcmp($b['timestamp'], $a['timestamp']); // newest first
            });
            echo json_encode($log);
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
            $table_no = isset($input['table_no']) ? $input['table_no'] : '';
            
            $active = read_json("active_orders.json", []);
            $key = "table_" . $table_no;
            
            if (!isset($active[$key])) {
                http_response_code(404);
                echo json_encode(["status" => "error", "message" => "No active session for Table $table_no"]);
                exit;
            }
            
            $session = $active[$key];
            
            // Consolidate items
            $bill_items = [];
            $subtotal = 0;
            foreach ($session['orders'] as $ord) {
                foreach ($ord['items'] as $it) {
                    $item_key = $it['name'] . '||' . (isset($it['variant']) ? $it['variant'] : '');
                    if (!isset($bill_items[$item_key])) {
                        $bill_items[$item_key] = [
                            "name" => $it['name'],
                            "variant" => isset($it['variant']) ? $it['variant'] : 'Portion',
                            "price" => floatval($it['price']),
                            "quantity" => 0
                        ];
                    }
                    $bill_items[$item_key]['quantity'] += intval($it['quantity']);
                    $subtotal += floatval($it['price']) * intval($it['quantity']);
                }
            }
            
            $svc_charge = round($subtotal * 0.10, 2);
            $tax = round($subtotal * 0.05, 2);
            $total = $subtotal + $svc_charge + $tax;
            // Unguessable ID, so people cannot browse other customers' bills
            $invoice_id = "INV-" . time() . "-" . strtoupper(bin2hex(random_bytes(4)));
            
            $invoice = [
                "invoice_id" => $invoice_id,
                "table_no" => $table_no,
                "customer_name" => $session['customer_name'],
                "customer_phone" => $session['customer_phone'],
                "timestamp" => date("Y-m-d\TH:i:s\Z"),
                "subtotal" => $subtotal,
                "service_charge" => $svc_charge,
                "tax" => $tax,
                "total" => $total,
                "items" => array_values($bill_items)
            ];
            
            // Save invoice
            $invoices = read_json("invoices.json", []);
            $invoices[] = $invoice;
            write_json("invoices.json", $invoices);
            
            // Delete active table
            unset($active[$key]);
            write_json("active_orders.json", $active);
            
            // Mock SMS sending log
            $sms_sent = read_json("sms_sent.json", []);
            $sms_msg = "Thank You for Visiting Downtown Luka, Here's your e-bill: http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['SCRIPT_NAME']) . "/invoice.html?id=" . $invoice_id;
            $sms_sent[] = [
                "timestamp" => date("Y-m-d\TH:i:s\Z"),
                "to" => $session['customer_phone'],
                "message" => $sms_msg
            ];
            write_json("sms_sent.json", $sms_sent);
            
            write_audit_log($staff_user, "Generated Invoice for Table $table_no. Total: ₹$total");
            write_audit_log("System", "Sent SMS e-bill to customer (" . $session['customer_phone'] . ")");
            
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
                "pending_orders" => $pending
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
