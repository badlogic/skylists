#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/skylists.mariozechner.at


rsync -avz --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "export SKYLISTS_DB=$SKYLISTS_DB && export SKYLISTS_DB_USER=$SKYLISTS_DB_USER && export SKYLISTS_DB_PASSWORD=$SKYLISTS_DB_PASSWORD && cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi