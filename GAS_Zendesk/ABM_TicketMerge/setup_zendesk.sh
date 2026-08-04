#!/bin/bash
set -e
ZENDESK_EMAIL='kjw@spigen.com'
ZENDESK_TOKEN='QhM2AiBYwTZTSb04Qjor918PHtttxp8xAzCFfFsg'
ZENDESK_SUBDOMAIN='spigenhelp'
GAS_EXEC_URL="$1"   # e.g. https://script.google.com/macros/s/AKfycb.../exec
WEBHOOK_SECRET='xN61CnX8OWX1O3lquwj-JFi6YTmFeezTaVhHsWZXvi8'

AUTH="${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}"

echo "Creating webhook..."
WEBHOOK_RESP=$(curl -s -X POST "https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/webhooks" \
  -u "$AUTH" -H "Content-Type: application/json" \
  -d "{\"webhook\":{\"name\":\"ABM Ticket Merge\",\"endpoint\":\"${GAS_EXEC_URL}?secret=${WEBHOOK_SECRET}\",\"http_method\":\"POST\",\"request_format\":\"json\",\"status\":\"active\"}}")
echo "$WEBHOOK_RESP"
WEBHOOK_ID=$(echo "$WEBHOOK_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['webhook']['id'])")
echo "Webhook ID: $WEBHOOK_ID"

echo "Creating trigger..."
TRIGGER_RESP=$(curl -s -X POST "https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/triggers.json" \
  -u "$AUTH" -H "Content-Type: application/json" \
  -d "{\"trigger\":{\"title\":\"ABM Ticket Merge - dedupe on create\",\"conditions\":{\"all\":[{\"field\":\"update_type\",\"operator\":\"is\",\"value\":\"Create\"},{\"field\":\"tags\",\"operator\":\"includes\",\"value\":\"buyer_message_amazon\"}]},\"actions\":[{\"field\":\"notification_webhook\",\"value\":[\"${WEBHOOK_ID}\",\"{\\\"ticket_id\\\": {{ticket.id}}}\"]}]}}")
echo "$TRIGGER_RESP"
