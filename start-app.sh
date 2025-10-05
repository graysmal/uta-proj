#!/bin/bash

# Script to start both frontend and backend in separate screen sessions

echo "Starting application screens..."

# Start frontend (React dev server)
echo "Starting frontend in screen session 'web-frontend'..."
screen -dmS web-frontend bash -c "cd /root/uta-proj/web && npm run dev"

# Start backend (Node.js server)
echo "Starting backend in screen session 'api-backend'..."
screen -dmS api-backend bash -c "cd /root/uta-proj/api && node server.js"

echo "Sessions started successfully!"
echo ""
echo "To attach to frontend: screen -r web-frontend"
echo "To attach to backend:  screen -r api-backend"
echo ""
echo "List all screen sessions: screen -ls"
