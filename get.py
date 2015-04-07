#!/usr/bin/python

import sys, os, socket, time, json
from pysnmp.entity.rfc3413.oneliner import cmdgen

def pp(x):
    return x.prettyPrint()

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

def iftype(ift):
    iana = cmdGen.snmpEngine.msgAndPduDsp.mibInstrumController.mibBuilder.mibSymbols['IANAifType-MIB']
    return repr(iana['IANAifType'](ift)).split("'")[1]

oids_info = dict(
  ifIndex=str,
  ifDescr=str,
  ifName=str,
  ifAlias=str,
  ifType=iftype,
  ifMtu=int,
  ifSpeed=ifspeed,
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

def get_info(IP, community_name="public", ifid='ifIndex', oids=oids_info):
    errorIndication, errorStatus, errorIndex, varBindTable = cmdGen.nextCmd(
      cmdgen.CommunityData(community_name),
      cmdgen.UdpTransportTarget((IP, 161)),
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
        data['log'] = "%s_%s.log" % (IP,
          data[ifid].lower().replace("/", "_").replace("vlan-", "vl")
        )
        if data['ifName']!='Nu0':
          ret[data['ifIndex']] = data
      return ret

class SNMP:
  def __init__(self, addr, community_name="public"):
      self.community = cmdgen.CommunityData(community_name)
      self.transport = cmdgen.UdpTransportTarget((addr, 161))
  def getall(self, ids, n=16):
      ret = {}
      while ids:
        request = [ids.pop(0)]
        while ids and len(request)<n:
          request.append(ids.pop(0))
        result = self.getsome(request)
        for id in request:
          ret[id] = dict(
            ifInOctets = long(result.pop(0)[1]),
            ifOutOctets = long(result.pop(0)[1])
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
        return
      elif errorStatus:
        print('%s at %s' % (
            errorStatus.prettyPrint(),
            errorIndex and varBindTable[-1][int(errorIndex)-1] or '?'
          )
        )
        return
      try:
        return varBinds
      except AttributeError, err:
        print(err, id)
        return []

def update_io(cfg, tdir, community_name="public"):
    ids = cfg['ifs'].keys()
    IP = cfg['ip']
    for idx, io in SNMP(IP, community_name).getall(ids).items():
      logfile(os.path.join(tdir, cfg['ifs'][idx]['log'])).update(
        io['ifInOctets'], io['ifOutOctets']
      )

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
  def __init__(self, filename):
      self.filename = filename
      self.deltas = {}
      try:
        # binary mode required to allow seeking
        self.f = open(self.filename, "rb+")
        counter = self.f.readline()
        if counter:
          self.counter = tuple(long(x, 10) for x in counter.split(" ", 2))
        else:
          self.counter = ()
        if len(counter)!=self.counter_length:
          # load deltas and convert this file from MRTG to trafgrapher
          print "Converting file:", self.filename
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

if __name__ == "__main__":
  if sys.argv[1]=="cfg":
    name = sys.argv[2]
    try:
      name = socket.gethostbyaddr(name)[0]
    except:
      pass
    print json.dumps(dict(
      name = name,
      ip = socket.gethostbyname(name),
      ifs = get_info(*sys.argv[2:])
    ), indent=2, separators=(',', ': '))
  elif sys.argv[1]=="test":
    print SNMP(sys.argv[2]).getall(sys.argv[3:])
  else:
    cfg = json.load(open(sys.argv[1]))
    update_io(cfg, sys.argv[2], *sys.argv[3:])
