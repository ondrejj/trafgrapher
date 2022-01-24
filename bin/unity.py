#!/usr/bin/python3

'''
TrafGrapher DELL EMC UNITY performance monitor

(c) 2022 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Usage: tg_unity hostname /.../login_password_file /.../target_directory

Documentation from:
  https://www.dell.com/support/kbdoc/en-us/000009634/unity-how-to-use-curl-to-interact-with-unity-rest-api-user-correctable?lang=en
  https://dl.dell.com/content/docu69331_Dell_EMC_Unity_Family_Unisphere_Management_REST_API_Programmer's_Guide.pdf?request=akamai&request=akamai
  https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/h15161-dell_emc_unity-performance_metrics.pdf

# uemcli -d hostname -u user -p pass /metrics/metric -availability historical show -output csv

"Path"
"sp.*.blockCache.global.summary.dirtyBytes"
"sp.*.cifs.global.basic.readAvgSize"
"sp.*.cifs.global.basic.readBytesRate"
"sp.*.cifs.global.basic.readIoTimeRate"
"sp.*.cifs.global.basic.readResponseTime"
"sp.*.cifs.global.basic.readsRate"
"sp.*.cifs.global.basic.responseTime"
"sp.*.cifs.global.basic.totalCallsRate"
"sp.*.cifs.global.basic.totalIoCallsRate"
"sp.*.cifs.global.basic.totalIoTimeRate"
"sp.*.cifs.global.basic.writeAvgSize"
"sp.*.cifs.global.basic.writeBytesRate"
"sp.*.cifs.global.basic.writeIoTimeRate"
"sp.*.cifs.global.basic.writeResponseTime"
"sp.*.cifs.global.basic.writesRate"
"sp.*.cifs.global.usage.currentConnections"
"sp.*.cifs.global.usage.currentOpenFiles"
"sp.*.cpu.summary.utilization"
"sp.*.fibreChannel.cmiscdPort.*.readBytesRate"
"sp.*.fibreChannel.cmiscdPort.*.readsRate"
"sp.*.fibreChannel.cmiscdPort.*.writeBytesRate"
"sp.*.fibreChannel.cmiscdPort.*.writesRate"
"sp.*.fibreChannel.fePort.*.readBytesRate"
"sp.*.fibreChannel.fePort.*.readsRate"
"sp.*.fibreChannel.fePort.*.writeBytesRate"
"sp.*.fibreChannel.fePort.*.writesRate"
"sp.*.fibreChannel.linkError.*.invalidCRCs"
"sp.*.fibreChannel.linkError.*.invalidTransmitsErrors"
"sp.*.fibreChannel.linkError.*.linkFailures"
"sp.*.fibreChannel.linkError.*.primitiveSequenceErrors"
"sp.*.fibreChannel.linkError.*.signalLosses"
"sp.*.fibreChannel.linkError.*.syncLosses"
"sp.*.fibreChannel.linkError.*.totalLinkErrors"
"sp.*.iscsi.fePort.*.readBytesRate"
"sp.*.iscsi.fePort.*.readsRate"
"sp.*.iscsi.fePort.*.writeBytesRate"
"sp.*.iscsi.fePort.*.writesRate"
"sp.*.net.basic.inBytesRate"
"sp.*.net.basic.outBytesRate"
"sp.*.net.device.*.bytesInRate"
"sp.*.net.device.*.bytesOutRate"
"sp.*.net.device.*.errorsInRate"
"sp.*.net.device.*.errorsOutRate"
"sp.*.net.device.*.lengthErrorsInRate"
"sp.*.net.device.*.pktsInRate"
"sp.*.net.device.*.pktsOutRate"
"sp.*.net.namespace.*.inBytesRate"
"sp.*.net.namespace.*.outBytesRate"
"sp.*.nfs.basic.readAvgSize"
"sp.*.nfs.basic.readBytesRate"
"sp.*.nfs.basic.readIoTimeRate"
"sp.*.nfs.basic.readResponseTime"
"sp.*.nfs.basic.readsRate"
"sp.*.nfs.basic.responseTime"
"sp.*.nfs.basic.totalIoCallsRate"
"sp.*.nfs.basic.totalIoTimeRate"
"sp.*.nfs.basic.writeAvgSize"
"sp.*.nfs.basic.writeBytesRate"
"sp.*.nfs.basic.writeIoTimeRate"
"sp.*.nfs.basic.writeResponseTime"
"sp.*.nfs.basic.writesRate"
"sp.*.nfs.currentThreads"
"sp.*.nfs.totalCallsRate"
"sp.*.physical.disk.*.averageQueueLength"
"sp.*.physical.disk.*.readBytesRate"
"sp.*.physical.disk.*.readsRate"
"sp.*.physical.disk.*.responseTime"
"sp.*.physical.disk.*.serviceTime"
"sp.*.physical.disk.*.totalCallsRate"
"sp.*.physical.disk.*.writeBytesRate"
"sp.*.physical.disk.*.writesRate"
"sp.*.storage.filesystem.*.clientReadBytesRate"
"sp.*.storage.filesystem.*.clientReadSizeAvg"
"sp.*.storage.filesystem.*.clientReadTimeAvg"
"sp.*.storage.filesystem.*.clientReadsRate"
"sp.*.storage.filesystem.*.clientWriteBytesRate"
"sp.*.storage.filesystem.*.clientWriteSizeAvg"
"sp.*.storage.filesystem.*.clientWriteTimeAvg"
"sp.*.storage.filesystem.*.clientWritesRate"
"sp.*.storage.filesystem.*.readBytesRate"
"sp.*.storage.filesystem.*.readSizeAvg"
"sp.*.storage.filesystem.*.readsRate"
"sp.*.storage.filesystem.*.writeBytesRate"
"sp.*.storage.filesystem.*.writeSizeAvg"
"sp.*.storage.filesystem.*.writesRate"
"sp.*.storage.lun.*.avgReadSize"
"sp.*.storage.lun.*.avgWriteSize"
"sp.*.storage.lun.*.queueLength"
"sp.*.storage.lun.*.readBytesRate"
"sp.*.storage.lun.*.readsRate"
"sp.*.storage.lun.*.responseTime"
"sp.*.storage.lun.*.snap.*.readBytesRate"
"sp.*.storage.lun.*.snap.*.readsRate"
"sp.*.storage.lun.*.snap.*.writeBytesRate"
"sp.*.storage.lun.*.snap.*.writesRate"
"sp.*.storage.lun.*.totalCallsRate"
"sp.*.storage.lun.*.writeBytesRate"
"sp.*.storage.lun.*.writesRate"
"sp.*.storage.pool.*.lun.*.dataSizeAllocated"
"sp.*.storage.pool.*.sizeFree"
"sp.*.storage.pool.*.sizeSubscribed"
"sp.*.storage.pool.*.sizeTotal"
"sp.*.storage.pool.*.sizeUsed"
"sp.*.storage.pool.*.snapshotSizeUsed"
"sp.*.storage.vvol.pool.*.datastore.*.readBytesRate"
"sp.*.storage.vvol.pool.*.datastore.*.readsRate"
"sp.*.storage.vvol.pool.*.datastore.*.responseTime"
"sp.*.storage.vvol.pool.*.datastore.*.writeBytesRate"
"sp.*.storage.vvol.pool.*.datastore.*.writesRate"
'''

import sys
import os
import time
import requests
from trafgrapher import logfile_simple

# suppress SSL certificate warnings from urllib3
from urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)

headers = {
    "X-EMC-REST-CLIENT": "true",
    "Accept": "application/json",
    "Content-type": "application/json"
}

session = requests.Session()
hostname = sys.argv[1]
userpass = tuple(open(sys.argv[2]).read().strip().split(":", 1))
target_dir = sys.argv[3]

def get(path):
    url = "https://%s/api/%s" % (hostname, path)
    req = session.get(url, headers=headers, auth=userpass, verify=False)
    data = req.json()
    return data

# login
get("types/loginSessionInfo/instances")

lunids = get("types/lun/instances?compact=true&fields=id,name")["entries"]
luns = {x["content"]["id"]: x["content"]["name"] for x in lunids}

def rw_bi(*prefixes):
    return ' OR '.join([
        ' OR '.join(
            'path EQ "sp.*.%s.*.%s"' % (prefix, x)
            for x in [
                'readBytesRate', 'writeBytesRate',
                'readsRate', 'writesRate',
                'responseTime'
            ]
        )
        for prefix in prefixes
    ])

metrics = get(
  "types/metricValue/instances?filter=("
  + rw_bi(
          "storage.lun",
          #"storage.vvol.pool.*.datastore",
          "physical.disk"
    ) +
  ")"
  " AND interval EQ 300"
  " AND timestamp GE \"2022-01-10T00:00:00.000Z\""
  "&per_page=2"
  "&compact=true"
  #"&with_entrycount=true"
)

#from pprint import pprint
#pprint(metrics)

for row in metrics["entries"]:
  content = row["content"]
  path = content["path"].split(".")
  if "values" not in content:
    print("Missing values:", row)
    continue # skip
  values = content["values"]
  ts = time.mktime(time.strptime(content["timestamp"], "%Y-%m-%dT%H:%M:%S.000Z"))
  age = time.mktime(time.gmtime())-ts
  if "Bytes" in path[-1]:
    unit = "B/s"
  else:
    unit = "io/s"
  if age>content["interval"]:
    # process only finished intervals
    #print(content["timestamp"], path[3], path[-1])
    if path[3]=="disk":
      for disk_name in values["spa"].keys():
        value = values["spa"][disk_name]+values["spb"][disk_name]
        lf = logfile_simple(
               os.path.join(target_dir, "TG_disk_%s_%s.log"
                 % (disk_name, path[-1])),
               (hostname, disk_name, path[-1], unit)
             )
        lf.save((ts+3600, value*1024))
    elif path[3]=="vvol":
      print(row)
    elif path[3]=="lun":
      lun_values = {
        lun_name: values["spa"][lun_id]+values["spb"][lun_id]
        for lun_id, lun_name in luns.items()
        # ignore lun_ids, which are only on one SP, they are teporary
        if lun_id in values["spa"] and lun_id in values["spb"]
      }
      for lun_name, value in lun_values.items():
        lf = logfile_simple(
               os.path.join(target_dir, "TG_lun_%s_%s.log"
                 % (lun_name, path[-1])),
               (hostname, lun_name, path[-1], unit)
             )
        lf.save((ts+3600, value*1024))
    else:
      print("Unknown path:", path)
  #else:
  #  print(content["timestamp"], path[3], path[-1], "ignored")

if "--list" in sys.argv:
  print(luns)
