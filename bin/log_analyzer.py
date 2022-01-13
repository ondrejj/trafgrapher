#!/usr/bin/python3

import sys, os, shlex, json, hashlib
from datetime import datetime
from tgc import grouper

# group also latest minutes
del grouper.compress_intervals[600]

json_default = {
  "ip": "salstar.sk",
  "ifs": {}
}

def hash(s):
    return hashlib.sha1(s.encode('utf8')).hexdigest()

class log(object):
  def __init__(self, filename):
      self.f = open(filename)
      self.size = os.lstat(filename).st_size
      self.hashkeys = {}
      self.grouper = grouper()
      self.read()
  def add(self, date, key, array, hashfx=str):
      hkey = hashfx(key)
      self.hashkeys[hkey] = key
      if hkey not in array:
        array[hkey] = {date: [0]}
      if date not in array[hkey]:
        array[hkey][date] = [0]
      array[hkey][date][0] += 1
  def read(self):
      deltas = {}
      ips = {}
      agents = {}
      while True:
        row = self.f.readline()
        if not row:
          break
        if self.size:
          sys.stderr.write("%d%%\r" % (self.f.tell()*100/self.size))
        row = shlex.split(row)
        #row = row.split(" ", 5)
        date = self.get_date(row)
        if date in deltas:
          deltas[date][0] += 1
        else:
          deltas[date] = [1]
        self.add(date, self.get_ip(row), ips)
        self.add(date, self.get_agent(row), agents, hash)
      self.grp = grouper()
      self.grp.load(deltas)
      self.ips = ips
      self.agents = agents
  def save(self, path):
      # save counter
      lf = open(path+"/counter.log", "w")
      lf.write("counter\t-\t-\t-\n")
      for key, value in self.grp.items(fx=['avg']):
        lf.write("%s %s\n" % (key, value[0]))
      lf.close()
      # save IP data
      js = json_default
      ifs = js["ifs"]
      for ip in self.ips.keys():
        if len(self.ips[ip])<100: continue
        ifs[ip] = {
          "index": 1,
          "log": "ip-%s.log" % ip,
          "ifDescr": ip,
          "unit": "#"
        }
        grp = grouper()
        grp.load(self.ips[ip])
        lf = open("%s/ip-%s.log" % (path, ip), "w")
        lf.write("%s\t-\t-\t-\n" % ip)
        for key, value in grp.items(fx=['avg']):
          lf.write("%s %s\n" % (key, value[0]))
        lf.close()
      open(path+"/ips.json", "w").write(json.dumps(js))
      # save agent data
      js = json_default
      ifs = js["ifs"]
      for agent in self.agents.keys():
        #if len(self.agents[agent])<100: continue
        ifs[agent] = {
          "index": 1,
          "log": "agent-%s.log" % agent,
          "ifDescr": self.hashkeys[agent],
          "unit": "#"
        }
        grp = grouper()
        grp.load(self.agents[agent])
        lf = open("%s/agent-%s.log" % (path, agent), "w")
        lf.write("%s\t-\t-\t-\n" % self.hashkeys[agent])
        for key, value in grp.items(fx=['avg']):
          lf.write("%s %s\n" % (key, value[0]))
        lf.close()
      open(path+"/agents.json", "w").write(json.dumps(js))

class nginx(log):
  def get_ip(self, row):
      # allow proxy request info
      return row[10] or row[0]
  def get_date(self, row):
      # 24/Oct/2018:03:27:19 +0200
      ds = (row[3]+" "+row[4]).strip("[]")
      return datetime.strptime(ds, "%d/%b/%Y:%H:%M:%S %z").timestamp()
  def get_method(self, row):
      return row[5]
  def get_ret(self, row):
      return row[6]
  def get_size(self, row):
      return row[7]
  def get_agent(self, row):
      return row[9]

for fn in sys.argv[1:]:
  nginx(fn).save("/home/ondrejj/ln/public/tg")
