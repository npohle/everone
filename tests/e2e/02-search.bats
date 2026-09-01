#!/usr/bin/env bats

@test "SEARCH-001: search for a document with specific content" {

    agent-browser --session "$RUN_ID" find placeholder "Search OneDrive…" fill "Anywhere"
    agent-browser --session "$RUN_ID" wait --load networkidle

    agent-browser --session "$RUN_ID" screenshot "$ARTEFACTS_DIR/02-01-input.png"
    
    count="$(agent-browser --session "$RUN_ID" get count '#listing .row:not(.head)')"
    [ "$count" -eq 1 ]

}