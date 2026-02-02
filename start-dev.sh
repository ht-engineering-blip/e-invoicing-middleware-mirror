#!/bin/bash
npx concurrently "bun dev" "docker-compose --profile tools up"