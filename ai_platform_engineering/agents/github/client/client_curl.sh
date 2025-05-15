curl -s -H "Content-Type: application/json"      -H "x-api-key: $API_KEY"      -d '{
           "agent_id": "'"$AGENT_ID"'",
           "input": {
             "argocd_input": {
               "messages": [
                 {
                   "type": "human",
                   "content": "Get version information of the ARGO CD server"
                 }
               ]
             }
           },
           "config": {
             "configurable": {}
           }
         }'      http://127.0.0.1:$WFSM_PORT/runs/wait