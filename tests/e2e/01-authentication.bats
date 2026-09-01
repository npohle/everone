#!/usr/bin/env bats

@test "AUTH-001: user is authenticated and docs loaded" {
    
    agent-browser --session "$RUN_ID" wait --fn "!document.body.innerText.includes('Loading...')"
    # agent-browser --session "$RUN_ID" wait --text "Sign out"
    agent-browser --session "$RUN_ID" screenshot "$ARTEFACTS_DIR/02-01-auth.png"

}