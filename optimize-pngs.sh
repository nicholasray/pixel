#!/bin/bash

start_time=$(date +%s)

docker compose run --rm png-optimizer

end_time=$(date +%s)
duration=$((end_time - start_time))

echo -e "\033[0;32mpng-optimizer duration: $duration seconds\033[0m"