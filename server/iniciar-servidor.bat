@echo off
title 21 Blackjack - Servidor
cd /d %~dp0
node --disable-warning=ExperimentalWarning index.js
pause
