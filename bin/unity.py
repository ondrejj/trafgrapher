#!/usr/bin/python3

# Documentation from:
# https://www.dell.com/support/kbdoc/en-us/000009634/unity-how-to-use-curl-to-interact-with-unity-rest-api-user-correctable?lang=en
# https://dl.dell.com/content/docu69331_Dell_EMC_Unity_Family_Unisphere_Management_REST_API_Programmer's_Guide.pdf?request=akamai&request=akamai
# https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/h15161-dell_emc_unity-performance_metrics.pdf

import sys
import requests
import trafgrapher

# Suppress only the single warning from urllib3 needed.
from urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)

headers = {
    "X-EMC-REST-CLIENT": "true",
    "Accept": "application/json",
    "Content-type": "application/json"
}

session = requests.Session()

def get(path):
    url = "https://%s/api/%s" % (sys.argv[1], path)
    userpass = tuple(open(sys.argv[2]).read().strip().split(":", 1))
    req = session.get(url, headers=headers, auth=userpass, verify=False)
    data = req.json()
    return data

# login
get("types/loginSessionInfo/instances")

lunids = get("types/lun/instances?compact=true&fields=id,name")["entries"]
luns = {x["content"]["id"]: x["content"]["name"] for x in lunids}

metrics = get(
  "types/metricValue/instances?filter="
  "("
    "path EQ \"sp.*.storage.lun.*.writeBytesRate\""
      " OR path EQ \"sp.*.storage.lun.*.readBytesRate\""
      " OR path EQ \"sp.*.storage.lun.*.writesRate\""
      " OR path EQ \"sp.*.storage.lun.*.readsRate\""
  ")"
  " AND interval EQ 300"
  " AND timestamp GE \"2022-01-10T00:00:00.000Z\""
  #"&per_page=5000"
  #"&compact=true"
  #"&with_entrycount=true"
)

print("\n".join([x["content"]["timestamp"] for x in metrics["entries"]]))

'''
{'content': {
  'path': 'sp.*.storage.lun.*.readsRate',
  'timestamp': '2022-01-12T09:25:00.000Z',
  'interval': 300,
  'values': {'spa': {'sv_2': 0.0, 'sv_3': 0.0, 'sv_1': 0.0, 'sv_4': 0.0},
             'spb': {'sv_2': 0.0, 'sv_3': 0.0, 'sv_1': 0.0, 'sv_4': 0.0}}}}
'''

#while True:
#  page = [x["href"] for x in metrics["links"] if x["rel"]=="next"]
#  r = get(metrics["@base"]+page)
#  print(r)

for row in metrics["entries"]:
  content = row["content"]
  path = content["path"].split(".")[-1]
  values = content["values"]
  lun_values = {
    lun_name: values["spa"][lun_id]+values["spb"][lun_id]
    for lun_id, lun_name in luns.items()
  }
  print(content["timestamp"], path, lun_values)
