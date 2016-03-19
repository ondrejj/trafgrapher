#!/usr/bin/python -S

'''
Process nagios performance data for TrafGrapher

(c) 2016 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Testing variables:
export NAGIOS_PERF_LOG_DIR=/tmp/perf
export NAGIOS_HOSTNAME=www
#export NAGIOS_SERVICEDISPLAYNAME=PING
#export NAGIOS_SERVICEPERFDATA='rta=1.276000ms;100.000000;500.000000;0.000000 pl=0%;30;60;0'
export NAGIOS_SERVICEDISPLAYNAME=nrpe_eth0
export NAGIOS_SERVICEPERFDATA='collisions=0c;1;10;0;131072000 rx_bytes=408966251704c;117964800;124518400;0;131072000 tx_bytes=6116960562c;117964800;124518400;0;131072000 rx_packets=198208226c;;;0;131072000 tx_packets=76580546c;;;0;131072000 rx_errors=0c;1;10;0;131072000 tx_errors=0c;1;10;0;131072000 rx_dropped=0c;1;10;0;131072000 tx_dropped=0c;1;10;0;131072000'
export NAGIOS_TIMET=1457008744
./process_perfdata.py
'''

import sys, re, os, time

prefix = os.environ.get("NAGIOS_PERF_LOG_DIR", "/var/log/nagios/perf")

class grouper(dict):
  one_day = 24*3600
  compress_intervals = {
    one_day: 1,
    7*one_day: 300, # 5m
    30*one_day: 1800, # 30m
    62*one_day: 7200, # 2h
    int(4*365.25*one_day): one_day
  }
  def __getitem__(self, key):
      if not key in self:
        self[key] = []
      return dict.__getitem__(self, key)
  def items(self, counter=False):
      ret = []
      for key, values in dict.items(self):
        lv = len(values)
        val = sum([x for x in values])/lv # avg
        ret.append((key, val))
      return ret
  def load(self, deltas, start=None):
      if start is None:
        start = max(deltas.keys())
      intervals = self.compress_intervals.items()
      limit = None
      for t in sorted(deltas, reverse=True):
        if start-t>=limit:
          if intervals:
            limit, range = intervals.pop(0)
          else:
            break
        st = int(t/range)*range
        self[st].append(deltas[t])

class Logfiles:
  re_num_unit = re.compile("^(-?[0-9.]+)([a-zA-Z%]*)$")
  re_plain = re.compile("^[A-Za-z0-9:.,=_-]*$")
  def __init__(self, hostname, service, label):
      self.hsl = "%s\t%s\t%s" % (hostname, service, label)
      self.dir = "%s/%s/%s" \
        % (prefix, hostname, self.escape(service))
      self.filename = "%s/%s" % (self.dir, self.escape(label))
      if not os.path.isdir(self.dir):
        os.makedirs(self.dir)
      self.header = os.path.exists(self.filename)
  def escape(self, fn):
      if self.re_plain.search(fn):
        return fn
      return '~'+fn.encode("base64").strip()
  def escape_old(self, fn):
      ret = ''
      for x in fn:
        if (x>='a' and x<='z') or (x>='A' and x<='Z') or (x>='0' and x<='9') \
           or x in ':_-.,':
          ret += x
          continue
        else:
          ret += "%%%02x" % ord(x)
      return ret
  def update(self, utime, values):
      if not values[0]:
        return # do not process empty values
      mtime = os.stat(self.filename).st_mtime
      value, unit = self.re_num_unit.search(
        values[0].replace(",", ".")
      ).groups()
      self.f = open(self.filename, "at")
      if not self.header:
        self.f.write("\t".join([self.hsl, unit] + values[1:])+"\n")
      self.f.write("%d %s\n" % (utime, value))
      self.f.close()
      if mtime//grouper.one_day < time.time()//grouper.one_day:
        self.compress()
  def compress(self):
      # read current file
      in_f = open(self.filename, "rt")
      header = in_f.readline()
      data = {}
      for row in in_f.readlines():
        rowa = row.strip().split()
        data[int(rowa[0])] = float(rowa[1])
      in_f.close()
      # compress data
      grp = grouper()
      grp.load(data)
      ret = dict(grp.items(header.split("\t")[3]=="c"))
      # save new file
      out_f = open(self.filename+".tmp", "wt")
      out_f.write(header)
      for key in sorted(ret.keys()):
        val = ret[key]
        if int(val)==val:
          val = int(val)
        out_f.write("%d %s\n" % (key, val))
      out_f.close()
      # rename new file to old file
      os.rename(self.filename+".tmp", self.filename)

def mkindex(subdirs=False):
    os.chdir(prefix)
    filelist = []
    sublists = {}
    for root, dirs, files in os.walk("."):
      for file in files:
        root_file = os.path.join(root, file)
        if not file.startswith("index.html") and not file.endswith(".tmp"):
          filelist.append(root_file)
          split_root = root.split("/")
          host = split_root[1]
          host_file = ".//"+split_root[2]+"/"+file
          if not host in sublists:
            sublists[host] = [host_file]
          else:
            sublists[host].append(host_file)
    filelist.sort()
    open(os.path.join(prefix, "index.html"), "wt").write("\n".join(filelist))
    if subdirs:
      for host, files in sublists.items():
        open(os.path.join(prefix, host, "index.html"), "wt").write(
          "\n".join(sorted(files))
        )

if __name__ == "__main__":
  if "--make-index" in sys.argv:
    mkindex("--subdirs" in sys.argv)
  else:
    hostname = os.environ.get("NAGIOS_HOSTNAME")
    service_name = os.environ.get("NAGIOS_SERVICEDISPLAYNAME")
    service_perfdata = os.environ.get("NAGIOS_SERVICEPERFDATA")
    service_time = os.environ.get("NAGIOS_TIMET")
    #print >> sys.stderr, service_name, service_perfdata
    if service_name and service_perfdata:
      for data in service_perfdata.split(" "):
        label, values = data.split("=", 1)
        logfile = Logfiles(hostname, service_name, label)
        logfile.update(int(service_time), values.split(";"))
