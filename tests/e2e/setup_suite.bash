#!/usr/bin/env bash


# once for complete suite of bats files
setup_suite() {

    set -a
    source .env || true
    set +a

    export RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
    export ARTEFACTS_DIR="tests/artefacts/$RUN_ID"
    
    source tests/dev.sh
    start_and_authenticate $RUN_ID $ARTEFACTS_DIR false || return $?

    return 0 

}

teardown_suite() {

    agent-browser --session "$RUN_ID" close

}
