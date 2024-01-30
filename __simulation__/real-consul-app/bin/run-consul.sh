#!/bin/sh
consul agent -data-dir=/consul/data -config-dir=/consul/config -bootstrap-expect=3 &