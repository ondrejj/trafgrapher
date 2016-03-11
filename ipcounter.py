#!/usr/bin/python -S

'''
IPcounter
(c) 2016 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Usage: ipcounter.py [-h|--help] [--ipset download_cmd upload_cmd]
         [--iptables download_cmd upload_cmd]

Examples:
ipcounter.py --ipset "ipset list acc_download" "ipset list acc_upload" > /var/www/ipset/index.json
'''

import sys, json, os, getopt
from tg_snmpc import logfile

class base():
  def read(self):
      self.bytes = {}
      self.packets = {}
      return os.popen(self.cmd).readlines()

class iptables_src(base):
  type = "iptables"
  ip_column = 7
  def __init__(self, cmd):
      self.cmd = cmd
  def parse(self):
      # skip first 2 rows of header
      for row in self.read()[2:]:
        cols = row.strip().split()
        # yield IP, bytes, packets
        self.bytes[cols[self.ip_column]] = int(cols[1])
        self.packets[cols[self.ip_column]] = int(cols[0])
        yield cols[self.ip_column], int(cols[1]), int(cols[0])

class iptables_dst(iptables_src):
  ip_column = iptables_src.ip_column + 1

class ipset(base):
  type = "ipset"
  def __init__(self, cmd):
      self.cmd = cmd
  def parse(self):
      for row in self.read():
        if row and row[0].isdigit():
          cols = row.strip().split(" ")
          # yield IP, bytes, packets
          self.bytes[cols[0]] = int(cols[4])
          self.packets[cols[0]] = int(cols[2])
          yield cols[0], int(cols[4]), int(cols[2])

def mkindex(ip, name, parser_src, parser_dst):
    cfg = dict(
      ip = ip,
      name = name,
      cmd_type = parser_src.type,
      cmd_src = parser_src.cmd,
      cmd_dst = parser_dst.cmd,
      ifs = {}
    )
    ips = sorted(
      set([x[0] for x in parser_src.parse()])
       &
      set([x[0] for x in parser_dst.parse()])
    )
    for ip in ips:
      ipid = ip.replace("/", "_")
      cfg["ifs"][ipid] = dict(
        ifIndex = ipid,
        ifName = ip,
        ifAlias = ip,
        ifDescr = ip,
        log = ipid+'.log'
      )
    return cfg
    
if __name__ == "__main__":
  prefix = ""
  ps = pd = None
  opts, files = getopt.gnu_getopt(sys.argv[1:], 'h',
    ['help', 'mkcfg', 'prefix=', 'ipset', 'iptables'])
  opts = dict(opts)
  if "--help" in opts or "-h" in opts:
    print __doc__.strip()
    sys.exit()
  elif "--prefix" in opts:
    prefix = opts["--prefix"]
  elif "--ipset" in opts:
    ps = ipset(files[0])
    pd = ipset(files[1])
  elif "--iptables" in opts:
    ps = iptables_src(files[0])
    pd = iptables_dst(files[1])

  if ps or pd:
    cfg = mkindex("IP", ps.type, ps, pd)
    if prefix:
      cfg["prefix"] = prefix
    print json.dumps(cfg, indent=2)
  else:
    for filename in files:
      cfg = json.load(open(filename))
      prefix = os.path.dirname(filename)
      if "prefix" in cfg:
        prefix = cfg["prefix"]
      if cfg["cmd_type"] == "ipset":
        ps = ipset(cfg["cmd_src"])
        pd = ipset(cfg["cmd_dst"])
      elif cfg["cmd_type"] == "iptables":
        ps = iptables_src(cfg["cmd_src"])
        pd = iptables_dst(cfg["cmd_dst"])
      else:
        print "Unknown command type:", cfg["cmd_type"]
        break
      list(ps.parse())
      list(pd.parse())
      for ip in cfg["ifs"].values():
        ipid = ip['ifName']
        #print ip['ifName'], pd.bytes[ipid], ps.bytes[ipid]
        lf = logfile(os.path.join(prefix, ip['log']))
        lf.update(pd.bytes[ipid], ps.bytes[ipid])
