#!/bin/bash
echo 'Starting shell script to assign additional ip addresses for the same node'
ASSIGNED_IPS="${IP_UP},${IP_DELAY},${IP_DOWN}"
echo "Both , and space are separators"
SANITISED_ASSIGNED_IPS=${ASSIGNED_IPS// /,}
echo $SANITISED_ASSIGNED_IPS
IFS=","
for eachIP in $SANITISED_ASSIGNED_IPS
do
  if [ ! -z "$eachIP" ]
  then
    (exec echo ip address add "$eachIP"/16 dev eth0)
    (exec ip address add "$eachIP"/16 dev eth0)
  fi
done
echo 'Additional ip addresses assignment completed'