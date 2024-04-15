#!/bin/sh
if [ -x "$(command -v consul)" ]
then
  echo 'consul is setup in the container. starting consul...'
  consul agent -data-dir=/consul/data -config-dir=/consul/config -bootstrap-expect=3 &
  exit 0
else
  echo 'hashi-corp-consul is not installed/setup !!! possibly using dummy-consul'
  exit 1
fi