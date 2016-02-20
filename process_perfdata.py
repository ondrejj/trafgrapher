#!/usr/bin/python -S

import sys, os, re

prefix = os.environ.get("NAGIOS_PERF_LOG_DIR", "/var/log/nagios/perf")

class Logfiles:
  re_num_unit = re.compile("^(-?[0-9.]+)([a-zA-Z%]*)$")
  def __init__(self, hostname, service, label):
      self.hsl = "%s\t%s\t%s" % (hostname, service, label)
      self.dir = "%s/%s/%s" \
        % (prefix, hostname, self.escape(service))
      self.filename = "%s/%s" % (self.dir, self.escape(label))
      if not os.path.isdir(self.dir):
        os.makedirs(self.dir)
      self.header = os.path.exists(self.filename)
  def escape(self, fn):
      ret = ''
      for x in fn:
        if (x>='a' and x<='z') or (x>='A' and x<='Z') or (x>='0' and x<='9') \
           or x in ':_-.,':
          ret += x
          continue
        else:
          ret += "%%%02x" % ord(x)
      return ret
  def update(self, time, values):
      self.f = open(self.filename, "at")
      value, unit = self.re_num_unit.search(
        values[0].replace(",", ".")
      ).groups()
      if not self.header:
        self.f.write("\t".join([self.hsl, unit] + values[1:])+"\n")
      self.f.write("%d %s\n" % (time, value))

def mkindex():
    os.chdir(prefix)
    filelist = []
    for root, dirs, files in os.walk("."):
      for file in files:
        if file!="index.html":
          filelist.append(os.path.join(root, file))
    filelist.sort()
    open(os.path.join(prefix, "index.html"), "wt").write("\n".join(filelist))

if __name__ == "__main__":
  if "--make-index" in sys.argv:
    mkindex()
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
