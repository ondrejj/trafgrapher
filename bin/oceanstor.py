#!/usr/bin/python3

'''
Huawei OceanStor performance monitor

(c) 2025 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Usage: oceanstor.py hostname login_password_file /.../target_directory
'''

import sys
import os
import time
import requests
import json
from trafgrapher import logfile_simple

# Ignore SSL certificate validation errors
import urllib3
urllib3.disable_warnings()

class OceanStor:

  headers = {
      'Connection': 'keep-alive',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
  }

  def __init__(self, hostname, api_user, api_password):
      self.base_url = f"https://{hostname}:8088"
      self.api_url = f"{self.base_url}/deviceManager/rest/xxxxx/sessions"
      api_data = json.dumps({
          'scope': '0',
          'username': api_user,
          'password': api_password
      })
      api_connect = requests.post(self.api_url,
          verify=False,
          data = api_data,
          headers = self.headers,
          timeout = 3
      )
      api_connection = json.loads(api_connect.content.decode('utf8'))

      self.api_cookies = api_connect.cookies
      self.device_id = api_connection['data']['deviceid']
      self.headers['iBaseToken'] = api_connection['data']['iBaseToken']

  def logout(self):
      data = requests.delete(self.api_url,
          verify = False,
          headers = self.headers,
          cookies = self.api_cookies
      )
      #print("EXIT:", data.content)
      return data

  def get_resources(self, resource="lun"):
      #resources:
      #	disk, power, enclosure, controller, backup_power,
      #	expboard, intf_module, eth_port, sas_port, fc_port,
      #	fan, lun, diskpool, storagepool

      resource_info = json.loads(
          requests.get(
              f"{self.base_url}/deviceManager/rest/{self.device_id}/{resource}",
              verify = False,
              headers = self.headers,
              cookies = self.api_cookies
          ).content.decode('utf8')
      )

      #print(resource_info['data'][0]['NAME'])
      return resource_info['data']

  indicators = dict(
      readBytesRate = 23,	# MB/s
      readsRate = 25,		# IO/s
      writeBytesRate = 26,
      writesRate = 28
  )
  indicators_reverse = {v:k for k,v in indicators.items()}

  objects = dict(
      disk = 10,
      lun = 11,
      storagepool = 216,
      controller = 207,
      eth_port = 213,
      bond_port = 235
  )
  objects_reverse = {v:k for k,v in objects.items()}

  def get_performance_data(self, lun_ids, interval=600):
      # https://support.huawei.com/enterprise/en/doc/EDOC1100437729/2fb6aa/block-storage-performance-indicators?idPath=7919749|251366268|250389224|251366266|258158285
      now = int(time.time())*1000
      data = json.dumps({
        "begin_time": now-1000*interval,
        "end_time": now,
        "objects": [
          {
            "ids": lun_ids,
            "indicators": list(self.indicators.values()),
            "object_type": self.objects['lun']
          }
        ],
        "compute_mode": "avg"
      })

      resource_info = json.loads(
          requests.post(
              f"{self.base_url}/api/v2/pms/performance_data",
              data = data,
              verify = False,
              headers = self.headers,
              cookies = self.api_cookies
          ).content.decode('utf8')
      )
      return resource_info['data']


hostname = sys.argv[1]
api_user, api_password, rest_ignored = open(sys.argv[2]).read().split("\n", 3)
target_dir = sys.argv[3]

storage = OceanStor(
    hostname = hostname,
    api_user = api_user,
    api_password = api_password
)

lun_ids = [x["ID"] for x in storage.get_resources("lun")]
perf = storage.get_performance_data(lun_ids, 600)
storage.logout()

lun_perf = {}
for lun_data in perf:
    lun_name = lun_data['name']
    if lun_name not in lun_perf:
        lun_perf[lun_name] = {}
    item = storage.indicators_reverse[lun_data['indicator']]
    lun_perf[lun_name][item] = dict(zip(
        [x/1000 for x in lun_data['timestamp']],
        [float(x) for x in lun_data['indicator_values']]
    ))

for lun_name, lun_data in lun_perf.items():
    for item_name, item_data in lun_data.items():
        lf = logfile_simple(
            os.path.join(target_dir, f"TG_lun_{lun_name}_{item_name}.log"),
            (hostname, lun_name, item_name, "MB/s")
        )
        ts = list(item_data.keys())[-1]
        avg_value = sum(item_data.values()) / len(item_data)
        lf.save((ts, avg_value))
