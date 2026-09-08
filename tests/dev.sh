#!/usr/bin/env bash

is_port_free() {
    local port=$1
    ! nc -z 127.0.0.1 "$port" 2>/dev/null    
}

find_port() {
    for port in "$@"; do
        if is_port_free "$port"; then
            echo "$port"
            return 0
        fi
    done

    echo "No free port found in list: $*" >&2
    return 1
}

# poll `find` until the given text appears in the page snapshot, or time out (seconds)
function wait_for_text() {
    local session="$1" text="$2" timeout_s="${3:-30}"
    local tries=0
    while (( tries < timeout_s * 2 )); do
        if playwright-cli -s="$session" --raw find "$text" 2>/dev/null | grep -q "^Found"; then
            return 0
        fi
        sleep 0.5
        tries=$((tries + 1))
    done
    return 1
}

# start caddy file server with internal TLS enabled on a free port number picked from a fixed list
# start a browser session with a hostname mapping (required for OAuth flow). use --headed mode if not started from a bats test suite
# authenticate with Microsoft account specified in .env file or env vars
# kill caddy file server immediately after successful authentication because SPA can run without a server afterwards

function start_and_authenticate() {

    set -a
    source .env || true
    set +a

    set -e

    export RUN_ID="${1}"
    export ARTEFACTS_DIR="${2}"
    export HEADED="${3}"

    local HOST="npohle.github.io"

    echo "start_and_authenticate: RUN_ID=$RUN_ID"
    echo "start_and_authenticate: ARTEFACTS_DIR=$ARTEFACTS_DIR"
    echo "start_and_authenticate: HEADED=$HEADED"

    mkdir -p "$ARTEFACTS_DIR"

    export CADDYPORT=$(find_port "1443" "2443" "3443" "4443" "5443" "6443" "7443" "8443" "9443")
    printf "https://127.0.0.1:${CADDYPORT}, https://npohle.github.io:${CADDYPORT} {\n log\n tls internal\n root * $(git rev-parse --show-toplevel)/../\n file_server\n}" | caddy run --adapter caddyfile --config - >"$ARTEFACTS_DIR/caddy.log" 2>&1 &
    export CADDY_PID=$!

    # Wait until Caddy is actually available
    echo "Checking if Caddy is up and running on port $CADDYPORT"
    for _ in {1..50}; do
        if curl --silent --fail --insecure "https://127.0.0.1:$CADDYPORT/everone" >/dev/null; then

            echo "Caddy is up and running on port $CADDYPORT"

            # playwright-cli -s="$RUN_ID" close >/dev/null 2>&1 || true

            # playwright-cli's own --headed/headless launch option, keyed off the
            # host-resolver mapping onto the local Caddy port picked above; needs
            # ignoreHTTPSErrors because Caddy's internal CA isn't trusted by default
            local config; config=$(mktemp)
            echo "{\"browser\": {\"launchOptions\": {\"headless\": $([[ \"$HEADED\" == \"true\" ]] && echo false || echo true), \"args\": [\"--host-resolver-rules=MAP $HOST 127.0.0.1:$CADDYPORT\"]},\"contextOptions\": {\"ignoreHTTPSErrors\": true}}}" > "$config"
            playwright-cli -s="$RUN_ID" --config="$config" open "https://$HOST/everone"
            rm -f "$config"

            playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'Sign in with Microsoft' })"
            playwright-cli -s="$RUN_ID" tab-list
            playwright-cli -s="$RUN_ID" tab-select 1
            
            playwright-cli -s="$RUN_ID" fill "getByRole('textbox', { name: 'Email or phone number' })" "$TEST_USERNAME"
            playwright-cli -s="$RUN_ID" screenshot --filename="$ARTEFACTS_DIR/00-01-username.png"
            playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'Next' })"

            playwright-cli -s="$RUN_ID" fill "getByRole('textbox', { name: 'Password' })" "$TEST_PASSWORD"
            playwright-cli -s="$RUN_ID" screenshot --filename="$ARTEFACTS_DIR/00-02-password.png"
            playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'Next' })"

            playwright-cli -s="$RUN_ID" fill "getByRole('textbox', { name: 'Code' })" "$(oathtool --totp -b ${TEST_TOTP_SEED})"
            playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'Next' })"

            playwright-cli -s="$RUN_ID" screenshot --filename="$ARTEFACTS_DIR/00-03-stay.png"
            playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'No' })"


            echo "CHECK 1"
            playwright-cli -s="$RUN_ID" find "Load more"

            echo "CHECK 2"
            if wait_for_text "$RUN_ID" "Load more"; then
                echo "Authentication successful"
            else
                if wait_for_text "$RUN_ID" "needs your permission to"; then
                    playwright-cli -s="$RUN_ID" click "getByRole('button', { name: 'Accept' })"
                fi
                if wait_for_text "$RUN_ID" "Load more"; then
                    echo "Authentication successful"
                else
                    echo "Authentication failed"
                    playwright-cli -s="$RUN_ID" screenshot --filename="$ARTEFACTS_DIR/00-05-failed.png"
                    return 1
                fi
            fi

            playwright-cli -s="$RUN_ID" screenshot --filename="$ARTEFACTS_DIR/00-04-browser.png"
            

            kill "$CADDY_PID" 2>/dev/null || true
            wait "$CADDY_PID" 2>/dev/null || true

            echo "Caddy was closed on port $CADDYPORT"

            return 0
        fi
        sleep 0.1
    done

    echo "Caddy failed to start" >&2
    cat "caddy.log" >&2
    return 1

}

# Only execute this when the file is called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then

    export RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
    export ARTEFACTS_DIR="tests/artefacts/$RUN_ID"
    
    start_and_authenticate $RUN_ID $ARTEFACTS_DIR true || exit $?
    exit $?
fi