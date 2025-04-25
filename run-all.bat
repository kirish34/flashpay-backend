@echo off
start cmd /k "node server.js"
timeout /t 2
start cmd /k "node pos-listener.js"
timeout /t 2
start cmd /k "node ussd_simulation_flow.js"
echo All Flash Pay services launched!
