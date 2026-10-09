<?php
// Archivio condiviso del portale Leads: salva leads, contatti e import in un unico file
// nella cartella dei dati.

declare(strict_types=1);
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const COLLEZIONI = ['leads', 'contatti', 'imports'];
const MAX_BODY = 2 * 1024 * 1024;

// Compatibilità con PHP 7.4 e 8.0.
if (!function_exists('array_is_list')) {
    function array_is_list(array $a): bool { return $a === [] || array_keys($a) === range(0, count($a) - 1); }
}
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $h, string $n): bool { return strncmp($h, $n, strlen($n)) === 0; }
}

function rispondi(int $status, array $dati): void {
    http_response_code($status);
    echo json_encode($dati, JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Archivio su file --------------------------------------------------------
// Il file ha estensione .php e inizia con un blocco che termina subito: se qualcuno prova
// ad aprirlo dal browser non vede nulla, anche su hosting che ignorano il file .htaccess.
const INTESTAZIONE = "<?php http_response_code(404); exit; ?>\n";

function percorso(): string {
    if (!is_dir(CARTELLA_DATI) && !mkdir(CARTELLA_DATI, 0750, true)) {
        rispondi(500, ['error' => 'storage', 'message' => 'Impossibile creare la cartella dei dati']);
    }
    return CARTELLA_DATI . '/archivio.php';
}

/** Apre l'archivio con un blocco (condiviso per leggere, esclusivo per scrivere). */
function apri(bool $scrittura): array {
    $fh = fopen(percorso(), 'c+');
    if ($fh === false) rispondi(500, ['error' => 'storage', 'message' => "Impossibile aprire l'archivio"]);
    flock($fh, $scrittura ? LOCK_EX : LOCK_SH);
    $raw = stream_get_contents($fh);
    if ($raw !== false && str_starts_with($raw, INTESTAZIONE)) $raw = substr($raw, strlen(INTESTAZIONE));
    $store = $raw ? json_decode($raw, true) : null;
    if (!is_array($store)) $store = ['version' => 0, 'docs' => [], 'tomb' => []];
    return [$fh, $store];
}

function salva($fh, array $store): void {
    $json = json_encode($store, JSON_UNESCAPED_UNICODE);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, INTESTAZIONE . $json);
    fflush($fh);
}

function chiudi($fh): void {
    flock($fh, LOCK_UN);
    fclose($fh);
}

/** Unione come nell'archivio di claude.ai: gli oggetti si uniscono, liste e valori semplici si sostituiscono. */
function unisci(array $base, array $nuovo): array {
    foreach ($nuovo as $k => $v) {
        if (is_array($v) && !array_is_list($v) && isset($base[$k]) && is_array($base[$k]) && !array_is_list($base[$k])) {
            $base[$k] = unisci($base[$k], $v);
        } else {
            $base[$k] = $v;
        }
    }
    return $base;
}

function valida(string $c, string $id): void {
    if (!in_array($c, COLLEZIONI, true)) rispondi(400, ['error' => 'collection']);
    if (!preg_match('/^[A-Za-z0-9_.~:@+-]{1,200}$/', $id)) rispondi(400, ['error' => 'id']);
}

// --- Lettura: modifiche successive alla versione indicata -------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $since = max(0, (int)($_GET['since'] ?? 0));
    [$fh, $store] = apri(false);
    chiudi($fh);
    $changes = [];
    foreach ($store['docs'] as $c => $docs) {
        foreach ($docs as $id => $doc) {
            if ($doc['v'] > $since) $changes[] = ['c' => $c, 'id' => (string)$id, 'd' => $doc['d']];
        }
    }
    if ($since > 0) {
        foreach ($store['tomb'] as $c => $ids) {
            foreach ($ids as $id => $v) {
                if ($v > $since) $changes[] = ['c' => $c, 'id' => (string)$id, 'd' => null];
            }
        }
    }
    rispondi(200, ['version' => $store['version'], 'changes' => $changes]);
}

// --- Scrittura ---------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] !== 'POST') rispondi(405, ['error' => 'method']);
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) rispondi(413, ['error' => 'too_large']);
$req = json_decode($raw, true);
if (!is_array($req)) rispondi(400, ['error' => 'json']);

$op = (string)($req['op'] ?? '');
$c = (string)($req['c'] ?? '');
$id = (string)($req['id'] ?? '');
valida($c, $id);

[$fh, $store] = apri(true);
$attuale = $store['docs'][$c][$id]['d'] ?? null;

switch ($op) {
    case 'set':
    case 'update':
        if (!is_array($req['d'] ?? null) || array_is_list($req['d']) && $req['d'] !== []) {
            chiudi($fh);
            rispondi(400, ['error' => 'data']);
        }
        if ($op === 'update' && $attuale === null) {
            chiudi($fh);
            rispondi(404, ['error' => 'not_found']);
        }
        $nuovo = $op === 'set' ? $req['d'] : unisci($attuale, $req['d']);
        $store['version']++;
        $store['docs'][$c][$id] = ['v' => $store['version'], 'd' => $nuovo];
        unset($store['tomb'][$c][$id]);
        salva($fh, $store);
        chiudi($fh);
        rispondi(200, ['version' => $store['version'], 'd' => $nuovo]);

    case 'delete':
        $store['version']++;
        unset($store['docs'][$c][$id]);
        $store['tomb'][$c][$id] = $store['version'];
        salva($fh, $store);
        chiudi($fh);
        rispondi(200, ['version' => $store['version'], 'd' => null]);

    default:
        chiudi($fh);
        rispondi(400, ['error' => 'op']);
}
