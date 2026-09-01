#!/usr/bin/env bats

@test "BRAND-001: page title names the app" {

    title="$(agent-browser --session "$RUN_ID" get title)"
    [ "$title" = "EverOne: Browse Microsoft OneDrive" ]

}

@test "BRAND-002: topbar header line names the app" {

    agent-browser --session "$RUN_ID" wait --text "EverOne: Browse Microsoft OneDrive"

    brand="$(agent-browser --session "$RUN_ID" get text '.topbar .brand')"
    agent-browser --session "$RUN_ID" screenshot "$ARTEFACTS_DIR/03-01-brand.png"
    [[ "$brand" == *"EverOne: Browse Microsoft OneDrive"* ]]

}
