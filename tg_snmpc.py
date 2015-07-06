#!/usr/bin/python

'''
TrafGrapher SNMP client

Usage: tg_snmpc.py [--mkcfg|-c [community@]IP_or_hostname] \\
		[--write|-w index.json] [--mkdir|-d] \\
		[--id ifName] [--rename] \\
		[--verbose|-v] [--check]
       tg_snmpc.py [--verbose|-v] [community@]config.json \\
		[--filter=timestamp]
'''

import sys, os, socket, time, json, getopt
from pysnmp.entity.rfc3413.oneliner import cmdgen
#from pysnmp.proto.rfc1905 import NoSuchInstance

VERBOSE = False

def pp(x):
    return x.prettyPrint()

def ustr(x):
    '''Encode as UTF8 string.'''
    return str(x).decode("utf8", "replace")

def macaddr(x):
    ret = []
    try:
      x = long(x.prettyPrint()[2:], 16)
    except ValueError:
      return x.prettyPrint()
    except TypeError:
      return x.prettyPrint()
    for i in range(6):
      ret.insert(0, "%02x" % (x % 256))
      x = x/256
    return ':'.join(ret)

def ifspeed(speed, unit="b/s"):
    k = 1000
    speed = long(speed)
    if (speed>=k**3): return "%d G%s" % (speed/k**3, unit)
    if (speed>=k**2): return "%d M%s" % (speed/k**2, unit)
    if (speed>=k): return "%d k%s" % (speed/k, unit)
    return "%d %s" % (speed, unit)

def ifhighspeed(speed):
    return ifspeed(long(speed)*1000000)

def iftype(ift):
    iana = cmdGen.snmpEngine.msgAndPduDsp.mibInstrumController.mibBuilder.mibSymbols['IANAifType-MIB']
    return repr(iana['IANAifType'](ift)).split("'")[1]

oids_info = dict(
  ifIndex=str,
  ifDescr=str,
  ifName=str,
  ifAlias=ustr,
  ifType=iftype,
  ifMtu=int,
  ifSpeed=ifspeed,
  ifHighSpeed=ifhighspeed,
  ifPhysAddress=macaddr
)

oids_status = dict(
  ifAdminStatus=int,
  ifOperStatus=int,
  #ifConnectorPresent=bool,
)

oids_io = dict(
  ifIndex=str,
  ifHCInOctets=long,
  ifHCOutOctets=long,
)

cmdGen = cmdgen.CommandGenerator()
mib_source = \
  os.path.join(os.path.dirname(os.path.realpath(__file__)), 'pysnmp_mibs')

class SNMP:
  port = 161
  def __init__(self, addr, community_name="public"):
      self.addr = addr
      self.community = cmdgen.CommunityData(community_name)
      self.transport = cmdgen.UdpTransportTarget((addr, self.port))
  def get_info(self, ifid='ifIndex', log_prefix=None, oids=oids_info):
      if log_prefix is None:
        log_prefix = self.addr

      errorIndication, errorStatus, errorIndex, varBindTable = cmdGen.nextCmd(
        self.community,
        self.transport,
        *[
          cmdgen.MibVariable('IF-MIB', x).addMibSource(mib_source)
          for x in oids
         ]
      )

      if errorIndication:
        print(errorIndication)
      elif errorStatus:
        print('%s at %s' % (
            errorStatus.prettyPrint(),
            errorIndex and varBindTable[-1][int(errorIndex)-1] or '?'
          )
        )
      else:
        ret = {}
        for row in varBindTable:
          data = dict([
            (x[0].replace("ifHC", "if"), oids[x[0]](x[1][1]))
            for x in zip(oids, row)
          ])
          # check IO retrieval
          ifindex = data['ifIndex']
          io = self.getall([ifindex])
          if io[ifindex]['error']:
            print("Unable to get IO for id %s, ignoring ..." % ifindex)
            if VERBOSE:
              print(data)
              print(io)
            continue
          # ignored types and names
          if 'ifType' in data and data['ifType']=='ieee8023adLag':
            continue
          # use HighSpeed if possible
          if 'ifHighSpeed' in data:
            data['ifSpeed'] = data['ifHighSpeed']
            del data['ifHighSpeed']
          # append to log
          data['log'] = "%s_%s.log" % (log_prefix,
            data[ifid].lower().replace("/", "_")
          )
          if data['ifName']!='Nu0':
            ret[ifindex] = data
        return ret
  def getall(self, ids, n=16):
      ret = {}
      while ids:
        request = [ids.pop(0)]
        while ids and len(request)<n:
          request.append(ids.pop(0))
        result = self.getsome(request)
        for id in request:
          #if isinstance(ino, NoSuchInstance) \
          #   or isinstance(outo, NoSuchInstance):
          #  print("No such instance: ip: %s:%d, id: %s"
          #        % (self.addr, self.port, id))
          try:
            ino = result.pop(0)
            outo = result.pop(0)
            ret[id] = dict(
              ifInOctets = long(ino),
              ifOutOctets = long(outo),
              error = None
            )
          except (AttributeError, IndexError), err:
            ret[id] = dict(
              ifInOctets = None, ifOutOctets = None,
              error = "No such instance: ip: %s:%d, id: %s"
                      % (self.addr, self.port, id)
            )
      return ret
  def getsome(self, ids):
      mibvars = []
      for id in ids:
        mibvars.extend([
          cmdgen.MibVariable('IF-MIB', 'ifHCInOctets', int(id)
            ).addMibSource(mib_source),
          cmdgen.MibVariable('IF-MIB', 'ifHCOutOctets', int(id)
            ).addMibSource(mib_source)
        ])
      errorIndication, errorStatus, errorIndex, varBinds = cmdGen.getCmd(
        self.community,
        self.transport,
        *mibvars
      )
      if errorIndication:
        print(errorIndication)
        return []
      elif errorStatus:
        print('%s at %s' % (
            errorStatus.prettyPrint(),
            errorIndex and varBindTable[-1][int(errorIndex)-1] or '?'
          )
        )
        return []
      ret = []
      try:
        vars = dict(varBinds)
        for key in mibvars:
          if key in vars:
            ret.append(vars[key])
      except AttributeError, err:
        print(err, id)
      return ret

class grouper(dict):
  def __getitem__(self, key):
      if not key in self:
        self[key] = []
      return dict.__getitem__(self, key)
  def items(self):
      ret = []
      for key, values in dict.items(self):
        lv = len(values)
        ret.append((key, [
          sum([x[0] for x in values])/lv, # avg
          sum([x[1] for x in values])/lv, # avg
          max([x[2] for x in values]),
          max([x[3] for x in values])
        ]))
      return ret

class logfile:
  counter_format = "%010d %020d %020d\n"
  counter_length = len(counter_format % (0, 0, 0))
  one_day = 24*3600
  compress_intervals = {
    600: 1,
    3*one_day: 300,
    14*one_day: 1800,
    62*one_day: 7200,
    int(4*365.25*one_day): one_day
  }
  def __init__(self, filename, force_compress=False):
      self.filename = filename
      self.deltas = {}
      try:
        # binary mode required to allow seeking
        self.f = open(self.filename, "rb+")
        counter = self.f.readline()
        if counter:
          self.counter = tuple(long(x, 10) for x in counter.split(" ", 2))
          if self.counter[0]/self.one_day!=time.time()/self.one_day:
            # next day, force compress
            force_compress = True
        else:
          self.counter = ()
        if len(counter)!=self.counter_length:
          # load deltas and convert this file from MRTG to trafgrapher
          print("Converting file:", self.filename)
          self.load()
        elif force_compress:
          #print("Compress:", self.filename)
          self.load()
      except IOError:
        self.f = open(self.filename, "wb")
        self.counter = ()
  def load(self):
      for row in self.f.readlines():
        data = tuple(long(x, 10) for x in row.split(" ", 4))
        self.deltas[data[0]] = data[1:]
  def save(self, delta):
      if self.deltas:
        # save data when converting to new format
        #print("Full save:", self.filename)
        self.f.close()
        self.deltas[delta[0]] = delta[1:] # add current values
        self.compress()
        self.f = open(self.filename+'.tmp', "wb")
        self.f.write(self.counter_format % self.counter)
        for t in sorted(self.deltas, reverse=True):
          self.f.write("%d %d %d %d %d\n" % tuple([t]+list(self.deltas[t])))
        self.f.close()
        os.rename(self.filename+'.tmp', self.filename)
      else:
        self.f.seek(0)
        self.f.write(self.counter_format % self.counter)
        self.f.seek(0, 2) # EOF
        self.f.write("%d %d %d %d %d\n" % delta)
        self.f.close()
  def update(self, data_in, data_out):
      '''
      Update with current values
      '''
      #t = long(time.mktime(time.gmtime())) # UTC time
      t = long(time.time()) # Local time
      if self.counter and \
         self.counter[1]<data_in and self.counter[2]-data_out:
        delta_t = t - self.counter[0]
        if delta_t==0:
          # ignore, no delta time, avoid division by zero
          return
        delta_in = data_in-self.counter[1]
        delta_out = data_out-self.counter[2]
        delta = (t,
          delta_in/delta_t, delta_out/delta_t,
          delta_in/delta_t, delta_out/delta_t
        )
        #if delta[1]>12**8 or delta[2]>12**8 or delta[1]<0 or delta[2]<0:
        #  print(delta)
      else:
        delta = (t, 0, 0, 0, 0)
      self.counter = (t, data_in, data_out)
      self.save(delta)
  def compress(self):
      '''
      Compress data
      '''
      intervals = self.compress_intervals.items()
      limit = None
      start = self.counter[0]
      ret = grouper()
      for t in sorted(self.deltas, reverse=True):
        if start-t>=limit:
          if intervals:
            limit, range = intervals.pop(0)
          else:
            break
        st = int(t/range)*range
        ret[st].append(self.deltas[t])
      self.deltas = dict(ret.items())
  def filter(self, filter):
      if not filter:
        return self
      self.load()
      #for key, value in self.deltas.items():
      #  print key, value
      for key in filter.split(","):
        key = int(key)
        if key in self.deltas:
          del self.deltas[key]
      return self

def update_io(cfg, tdir, community_name="public", force_compress=False,
              filter=None):
    ids = cfg['ifs'].keys()
    IP = cfg['ip']
    for idx, io in SNMP(IP, community_name).getall(ids).items():
      if io['error']:
        print(io['error'])
        if VERBOSE:
          print(json.dumps(cfg['ifs'][idx], indent=2, separators=(',', ': ')))
      else:
        logfile(
          os.path.join(tdir, cfg['ifs'][idx]['log']),
          force_compress
        ).filter(
          filter
        ).update(
          io['ifInOctets'], io['ifOutOctets']
        )

if __name__ == "__main__":
  opts, files = getopt.gnu_getopt(sys.argv[1:], 'hctzw:dv',
    ['help', 'mkcfg', 'test', 'write=', 'mkdir', 'id=', 'rename',
     'verbose', 'check', 'filter='])
  opts = dict(opts)
  if "--verbose" in opts or "-v" in opts:
    VERBOSE = True
  if not files:
    print(__doc__)
    sys.exit()
  elif "--mkcfg" in opts or "-c" in opts:
    name = files[0]
    if "@" in name:
      community, name = name.split("@", 1)
    else:
      community = "public"
    log_prefix = name
    try:
      name = socket.gethostbyaddr(name)[0]
    except:
      pass
    if "--id" in opts:
      ifid = opts['--id']
    else:
      ifid = "ifIndex"
    if name == log_prefix:
      print("Connecting to: %s@%s" % (community, name))
    else:
      print("Connecting to: %s@%s [%s]" % (community, name, log_prefix))
    ifs = SNMP(name, community).get_info(ifid, log_prefix)
    ret = json.dumps(
      dict(name = name, ip = socket.gethostbyname(name), ifs = ifs),
      indent=2, separators=(',', ': ')
    )
    if "--write" in opts:
      out_filename = opts["--write"]
      dir = os.path.dirname(out_filename)
    elif "-w" in opts:
      out_filename = opts["-w"]
      dir = os.path.dirname(out_filename)
    else:
      out_filename = ""
      print(ret)
      dir = "."
    if "--rename" in opts:
      if not out_filename:
        print "ERROR: --write filename required for --rename option"
        sys.exit(1)
      rename_from = json.load(open(out_filename))
    if ifs:
      if "--check" in opts:
        for key, value in ifs.items():
          if not os.path.exists(os.path.join(dir, value['log'])):
            print("Missing log file: %s" % value['log'])
      if out_filename:
        if "--rename" in opts:
          rename_from = json.load(open(out_filename))
          for id in ifs:
            old_name = rename_from['ifs'][id]['log']
            if os.path.exists(old_name) and not os.path.exists(ifs[id]['log']):
              print "Rename: %s -> %s" % (old_name, ifs[id]['log'])
              os.rename(old_name, ifs[id]['log'])
        if os.path.exists(out_filename):
          os.rename(out_filename, out_filename+".old")
        if "--mkdir" in opts or "-d" in opts:
          if not os.path.isdir(dir):
            print("Creating missing directory: %s" % dir)
            os.makedirs(dir)
        open(out_filename, "wt").write(ret)
        print("Update command: %s %s@%s"
              % (sys.argv[0], community, out_filename))
  elif "--test" in opts or "-t" in opts:
    print(SNMP(files[0]).getall(files[1:]))
  else:
    filter = ""
    if "--filter" in opts:
      filter = opts["--filter"]
    for fn in files:
      if '@' in fn:
        community, fn = fn.split('@', 1)
      else:
        community = 'public'
      if not os.path.exists(fn):
        print("Configuration file doesn't exist [%s]!" % fn)
      else:
        cfg = json.load(open(fn))
        tdir = os.path.dirname(os.path.realpath(fn))
        update_io(cfg, tdir, community, '-z' in opts, filter=filter)
