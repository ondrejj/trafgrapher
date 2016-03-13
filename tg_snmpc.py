#!/usr/bin/python -S

'''
TrafGrapher SNMP client

(c) 2015-2016 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Usage: tg_snmpc.py [--mkcfg|-c [community@]IP_or_hostname] \\
		[--write|-w index.json] [--mkdir|-d] \\
		[--id ifName] [--rename] [--compress|-z] \\
		[--verbose|-v] [--check]
       tg_snmpc.py [--verbose|-v] [community@]config.json \\
		[--filter=timestamp]
       tg_snmpc.py [--ipset|--iptables] download_cmd upload_cmd

Examples:
  tg_snmpc -c public@10.0.0.1 -w index.json
  tg_snmpc index.json
  tg_snmpc index.json --filter=`date -d '2015-07-04 02:00:00' '+%s'`
  tg_snmpc --ipset "ipset list acc_download" "ipset list acc_upload"
'''

import sys, os, socket, time, json, getopt

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

IFTYPES = dict([(x[1],x[0]) for x in [
  ("other", 1),
  ("iso88026Man", 10),
  ("voiceEM", 100),
  ("voiceFXO", 101),
  ("voiceFXS", 102),
  ("voiceEncap", 103),
  ("voiceOverIp", 104),
  ("atmDxi", 105),
  ("atmFuni", 106),
  ("atmIma", 107),
  ("pppMultilinkBundle", 108),
  ("ipOverCdlc", 109),
  ("starLan", 11),
  ("ipOverClaw", 110),
  ("stackToStack", 111),
  ("virtualIpAddress", 112),
  ("mpc", 113),
  ("ipOverAtm", 114),
  ("iso88025Fiber", 115),
  ("tdlc", 116),
  ("gigabitEthernet", 117),
  ("hdlc", 118),
  ("lapf", 119),
  ("proteon10Mbit", 12),
  ("v37", 120),
  ("x25mlp", 121),
  ("x25huntGroup", 122),
  ("trasnpHdlc", 123),
  ("interleave", 124),
  ("fast", 125),
  ("ip", 126),
  ("docsCableMaclayer", 127),
  ("docsCableDownstream", 128),
  ("docsCableUpstream", 129),
  ("proteon80Mbit", 13),
  ("a12MppSwitch", 130),
  ("tunnel", 131),
  ("coffee", 132),
  ("ces", 133),
  ("atmSubInterface", 134),
  ("l2vlan", 135),
  ("l3ipvlan", 136),
  ("l3ipxvlan", 137),
  ("digitalPowerline", 138),
  ("mediaMailOverIp", 139),
  ("hyperchannel", 14),
  ("dtm", 140),
  ("dcn", 141),
  ("ipForward", 142),
  ("msdsl", 143),
  ("ieee1394", 144),
  ("if-gsn", 145),
  ("dvbRccMacLayer", 146),
  ("dvbRccDownstream", 147),
  ("dvbRccUpstream", 148),
  ("atmVirtual", 149),
  ("fddi", 15),
  ("mplsTunnel", 150),
  ("srp", 151),
  ("voiceOverAtm", 152),
  ("voiceOverFrameRelay", 153),
  ("idsl", 154),
  ("compositeLink", 155),
  ("ss7SigLink", 156),
  ("propWirelessP2P", 157),
  ("frForward", 158),
  ("rfc1483", 159),
  ("lapb", 16),
  ("usb", 160),
  ("ieee8023adLag", 161),
  ("bgppolicyaccounting", 162),
  ("frf16MfrBundle", 163),
  ("h323Gatekeeper", 164),
  ("h323Proxy", 165),
  ("mpls", 166),
  ("mfSigLink", 167),
  ("hdsl2", 168),
  ("shdsl", 169),
  ("sdlc", 17),
  ("ds1FDL", 170),
  ("pos", 171),
  ("dvbAsiIn", 172),
  ("dvbAsiOut", 173),
  ("plc", 174),
  ("nfas", 175),
  ("tr008", 176),
  ("gr303RDT", 177),
  ("gr303IDT", 178),
  ("isup", 179),
  ("ds1", 18),
  ("propDocsWirelessMaclayer", 180),
  ("propDocsWirelessDownstream", 181),
  ("propDocsWirelessUpstream", 182),
  ("hiperlan2", 183),
  ("propBWAp2Mp", 184),
  ("sonetOverheadChannel", 185),
  ("digitalWrapperOverheadChannel", 186),
  ("aal2", 187),
  ("radioMAC", 188),
  ("atmRadio", 189),
  ("e1", 19),
  ("imt", 190),
  ("mvl", 191),
  ("reachDSL", 192),
  ("frDlciEndPt", 193),
  ("atmVciEndPt", 194),
  ("opticalChannel", 195),
  ("opticalTransport", 196),
  ("propAtm", 197),
  ("voiceOverCable", 198),
  ("infiniband", 199),
  ("regular1822", 2),
  ("basicISDN", 20),
  ("teLink", 200),
  ("q2931", 201),
  ("virtualTg", 202),
  ("sipTg", 203),
  ("sipSig", 204),
  ("docsCableUpstreamChannel", 205),
  ("econet", 206),
  ("pon155", 207),
  ("pon622", 208),
  ("bridge", 209),
  ("primaryISDN", 21),
  ("linegroup", 210),
  ("voiceEMFGD", 211),
  ("voiceFGDEANA", 212),
  ("voiceDID", 213),
  ("mpegTransport", 214),
  ("sixToFour", 215),
  ("gtp", 216),
  ("pdnEtherLoop1", 217),
  ("pdnEtherLoop2", 218),
  ("opticalChannelGroup", 219),
  ("propPointToPointSerial", 22),
  ("homepna", 220),
  ("gfp", 221),
  ("ciscoISLvlan", 222),
  ("actelisMetaLOOP", 223),
  ("fcipLink", 224),
  ("rpr", 225),
  ("qam", 226),
  ("lmp", 227),
  ("cblVectaStar", 228),
  ("docsCableMCmtsDownstream", 229),
  ("ppp", 23),
  ("adsl2", 230),
  ("macSecControlledIF", 231),
  ("macSecUncontrolledIF", 232),
  ("aviciOpticalEther", 233),
  ("atmbond", 234),
  ("voiceFGDOS", 235),
  ("mocaVersion1", 236),
  ("ieee80216WMAN", 237),
  ("adsl2plus", 238),
  ("dvbRcsMacLayer", 239),
  ("softwareLoopback", 24),
  ("dvbTdm", 240),
  ("dvbRcsTdma", 241),
  ("x86Laps", 242),
  ("wwanPP", 243),
  ("wwanPP2", 244),
  ("eon", 25),
  ("ethernet3Mbit", 26),
  ("nsip", 27),
  ("slip", 28),
  ("ultra", 29),
  ("hdh1822", 3),
  ("ds3", 30),
  ("sip", 31),
  ("frameRelay", 32),
  ("rs232", 33),
  ("para", 34),
  ("arcnet", 35),
  ("arcnetPlus", 36),
  ("atm", 37),
  ("miox25", 38),
  ("sonet", 39),
  ("ddnX25", 4),
  ("x25ple", 40),
  ("iso88022llc", 41),
  ("localTalk", 42),
  ("smdsDxi", 43),
  ("frameRelayService", 44),
  ("v35", 45),
  ("hssi", 46),
  ("hippi", 47),
  ("modem", 48),
  ("aal5", 49),
  ("rfc877x25", 5),
  ("sonetPath", 50),
  ("sonetVT", 51),
  ("smdsIcip", 52),
  ("propVirtual", 53),
  ("propMultiplexor", 54),
  ("ieee80212", 55),
  ("fibreChannel", 56),
  ("hippiInterface", 57),
  ("frameRelayInterconnect", 58),
  ("aflane8023", 59),
  ("ethernetCsmacd", 6),
  ("aflane8025", 60),
  ("cctEmul", 61),
  ("fastEther", 62),
  ("isdn", 63),
  ("v11", 64),
  ("v36", 65),
  ("g703at64k", 66),
  ("g703at2mb", 67),
  ("qllc", 68),
  ("fastEtherFX", 69),
  ("iso88023Csmacd", 7),
  ("channel", 70),
  ("ieee80211", 71),
  ("ibm370parChan", 72),
  ("escon", 73),
  ("dlsw", 74),
  ("isdns", 75),
  ("isdnu", 76),
  ("lapd", 77),
  ("ipSwitch", 78),
  ("rsrb", 79),
  ("iso88024TokenBus", 8),
  ("atmLogical", 80),
  ("ds0", 81),
  ("ds0Bundle", 82),
  ("bsc", 83),
  ("async", 84),
  ("cnr", 85),
  ("iso88025Dtr", 86),
  ("eplrs", 87),
  ("arap", 88),
  ("propCnls", 89),
  ("iso88025TokenRing", 9),
  ("hostPad", 90),
  ("termPad", 91),
  ("frameRelayMPI", 92),
  ("x213", 93),
  ("adsl", 94),
  ("radsl", 95),
  ("sdsl", 96),
  ("vdsl", 97),
  ("iso88025CRFPInt", 98),
  ("myrinet", 99)
]])


def iftype(ift):
    #from pysnmp.entity.rfc3413.oneliner import cmdgen
    #cmdGen = cmdgen.CommandGenerator()
    #iana = cmdGen.snmpEngine.msgAndPduDsp.mibInstrumController.mibBuilder.mibSymbols['IANAifType-MIB']
    #return repr(iana['IANAifType'](ift)).split("'")[1]
    return IFTYPES.get(ift, 'UNKNOWN')

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

mib_source = \
  os.path.join(os.path.dirname(os.path.realpath(__file__)), 'pysnmp_mibs')

class SNMP:
  port = 161
  def __init__(self, addr, community_name="public"):
      import site
      from pysnmp.entity.rfc3413.oneliner import cmdgen
      #from pysnmp.proto.rfc1905 import NoSuchInstance
      self.cmdgen = cmdgen
      self.cmdGen = cmdgen.CommandGenerator()
      self.addr = addr
      self.community = cmdgen.CommunityData(community_name)
      self.transport = cmdgen.UdpTransportTarget((addr, self.port))
  def get_info(self, ifid='ifIndex', log_prefix=None, oids=oids_info):
      if log_prefix is None:
        log_prefix = self.addr

      errorIndication, errorStatus, errorIndex, varBindTable = \
        self.cmdGen.nextCmd(
          self.community,
          self.transport,
          *[
            self.cmdgen.MibVariable('IF-MIB', x).addMibSource(mib_source)
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
            print("Unable to get 64bit IO for id %s, ignoring ..." % ifindex)
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
  def get_uptime(self):
      errorIndication, errorStatus, errorIndex, varBindTable = \
        self.cmdGen.nextCmd(
          self.community, self.transport,
          self.cmdgen.MibVariable(
            'SNMPv2-MIB', 'sysUpTime'
          ).addMibSource(mib_source)
        )
      if not varBindTable:
        print "%s: %s" % (self.addr, errorIndication)
        return None
      return float(varBindTable[0][0][1])/100
  def getall(self, ids, n=16):
      ret = {}
      while ids:
        request = [ids.pop(0)]
        while ids and len(request)<n:
          request.append(ids.pop(0))
        result = self.getsome(request)
        for id in request:
          try:
            ino = result.pop(0)
            outo = result.pop(0)
            ret[id] = dict(
              ifInOctets = long(ino),
              ifOutOctets = long(outo),
              error = None
            )
          except (AttributeError, IndexError, ValueError), err:
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
          self.cmdgen.MibVariable('IF-MIB', 'ifHCInOctets', int(id)
            ).addMibSource(mib_source),
          self.cmdgen.MibVariable('IF-MIB', 'ifHCOutOctets', int(id)
            ).addMibSource(mib_source)
        ])
      errorIndication, errorStatus, errorIndex, varBinds = self.cmdGen.getCmd(
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
  one_day = 24*3600
  compress_intervals = {
    600: 1,
    3*one_day: 300,
    14*one_day: 1800,
    62*one_day: 7200,
    int(4*365.25*one_day): one_day
  }
  def __getitem__(self, key):
      if not key in self:
        self[key] = []
      return dict.__getitem__(self, key)
  def items(self, fx=['avg', 'avg', max, max]):
      ret = []
      for key, values in dict.items(self):
        lv = len(values)
        vals = []
        for id, func in enumerate(fx):
          if func=="avg":
            vals.append(sum([x[id] for x in values])/lv) # avg
          else:
            vals.append(func([x[id] for x in values]))
        ret.append((key, vals))
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

class logfile:
  counter_format = "%010d %020d %020d\n"
  counter_length = len(counter_format % (0, 0, 0))
  def __init__(self, filename, force_compress=False):
      self.filename = filename
      self.deltas = {}
      try:
        # binary mode required to allow seeking
        self.f = open(self.filename, "rb+")
        counter = self.f.readline()
        if counter:
          self.counter = tuple(long(x, 10) for x in counter.split(" ", 2))
          if self.counter[0]//grouper.one_day != time.time()//grouper.one_day:
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
        if row.strip():
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
  def update(self, data_in, data_out,
             gauge_in=False, gauge_out=False,
             uptime=None, counter_bits=None):
      '''
      Update with current values
      '''
      #t = long(time.mktime(time.gmtime())) # UTC time
      t = long(time.time()) # Local time
      delta_t = 1
      delta_in = 0
      delta_out = 0
      if self.counter:
        delta_t = t - self.counter[0]
        if delta_t==0:
          # ignore, no delta time, avoid division by zero
          return
        if self.counter[1]<=data_in:
          delta_in = data_in-self.counter[1]
        elif counter_bits and uptime is not None and delta_t<uptime:
          delta_in = 2**counter_bits - self.counter[1] + data_in
        if self.counter[2]<=data_out:
          delta_out = data_out-self.counter[2]
        elif counter_bits and uptime is not None and delta_t<uptime:
          delta_out = 2**counter_bits - self.counter[2] + data_out
      delta_in_pt = delta_in/delta_t
      delta_out_pt = delta_out/delta_t
      if gauge_in:
        delta_in_pt = data_in
      if gauge_out:
        delta_out_pt = data_out
      delta = (t, delta_in_pt, delta_out_pt, delta_in_pt, delta_out_pt)
      #if delta_in_pt>12**8 or delta_out_pt>12**8 \
      #   or delta_in_pt<0 or delta_out_pt<0:
      #  print(delta)
      self.counter = (t, data_in, data_out)
      self.save(delta)
  def compress(self):
      '''
      Compress data
      '''
      grp = grouper()
      grp.load(self.deltas, self.counter[0])
      self.deltas = dict(grp.items())
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
    snmpc = SNMP(IP, community_name)
    uptime = snmpc.get_uptime()
    if uptime is None:
      return
    for idx, io in snmpc.getall(ids).items():
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
          io['ifInOctets'], io['ifOutOctets'],
          uptime = uptime,
          counter_bits=cfg['ifs'][idx].get('counter_bits', 64)
        )

def read_file(filename, row_name, column):
    for row in open(filename, "r").readlines():
      row = row.strip().split()
      if row[0]==row_name:
        return int(row[column])
    return 0

def read_uptime(filename=None):
    if not filename:
      return None
    uptime = open(filename, "r").readline().strip().split(" ", 1)
    return float(uptime[0])

def update_local(cfg, force_compress=False):
    for key, value in cfg['ifs'].items():
      logfile(
        os.path.join(tdir, value['log']),
        force_compress
      ).update(
        read_file(
          value['rx_filename'],
          value['rx_row_name'], value['rx_column']
        ),
        read_file(
          value['tx_filename'],
          value['tx_row_name'], value['tx_column']
        ),
        value.get('rx_gauge', False),
        value.get('tx_gauge', False),
        read_uptime(value.get('uptime_filename')),
        value.get('counter_bits')
      )

# ipset and iptables counters for firewall accounting

class fwcounter_base():
  def read(self):
      self.bytes = {}
      self.packets = {}
      return os.popen(self.cmd).readlines()

class ipset(fwcounter_base):
  type = "ipset"
  def __init__(self, cmd):
      self.cmd = cmd
  def items(self):
      for row in self.read():
        if row and row[0].isdigit():
          cols = row.strip().split(" ")
          self.bytes[cols[0]] = int(cols[4])
          self.packets[cols[0]] = int(cols[2])
          yield cols[0], int(cols[4]), int(cols[2])

class iptables_src(fwcounter_base):
  type = "iptables"
  ip_column = 7
  def __init__(self, cmd):
      self.cmd = cmd
  def items(self):
      # skip first 2 rows of header
      for row in self.read()[2:]:
        cols = row.strip().split()
        self.bytes[cols[self.ip_column]] = int(cols[1])
        self.packets[cols[self.ip_column]] = int(cols[0])
        yield cols[self.ip_column], int(cols[1]), int(cols[0])

class iptables_dst(iptables_src):
  ip_column = iptables_src.ip_column + 1

def fwcounter_mkindex(name, ip, parser_src, parser_dst):
    cfg = dict(
      ip = ip,
      name = name,
      cmd_type = parser_src.type,
      cmd_src = parser_src.cmd,
      cmd_dst = parser_dst.cmd,
      ifs = {}
    )
    ips = sorted(
      set([x[0] for x in parser_src.items()])
       &
      set([x[0] for x in parser_dst.items()])
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
  opts, files = getopt.gnu_getopt(sys.argv[1:], 'hctzw:dv',
    ['help', 'mkcfg', 'test', 'write=', 'mkdir', 'id=', 'rename',
     'verbose', 'check', 'filter=', 'local',
     'iptables', 'ipset'])
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
  elif "--ipset" in opts:
    cfg = fwcounter_mkindex(
      socket.gethostname(), socket.gethostbyname(socket.gethostname()),
      ipset(files[0]), ipset(files[1])
    )
    print json.dumps(cfg, indent=2)
  elif "--iptables" in opts:
    cfg = fwcounter_mkindex(
      socket.gethostname(), socket.gethostbyname(socket.gethostname()),
      iptables_src(files[0]), iptables_dst(files[1])
    )
    print json.dumps(cfg, indent=2)
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
        continue
      cfg = json.load(open(fn))
      prefix = os.path.dirname(fn)
      if "prefix" in cfg:
        prefix = cfg["prefix"]
      if "--local" in opts:
        tdir = os.path.dirname(os.path.realpath(fn))
        update_local(cfg, tdir)
      elif "cmd_type" in cfg:
        if cfg["cmd_type"] == "ipset":
          ps = ipset(cfg["cmd_src"])
          pd = ipset(cfg["cmd_dst"])
        elif cfg["cmd_type"] == "iptables":
          ps = iptables_src(cfg["cmd_src"])
          pd = iptables_dst(cfg["cmd_dst"])
        else:
          print "Unknown command type:", cfg["cmd_type"]
          continue
        list(ps.items()), list(pd.items())
        for ip in cfg["ifs"].values():
          ipid = ip['ifName']
          #print ip['ifName'], pd.bytes[ipid], ps.bytes[ipid]
          lf = logfile(os.path.join(prefix, ip['log']))
          if ipid in pd.bytes and ipid in ps.bytes:
            lf.update(pd.bytes[ipid], ps.bytes[ipid])
          else:
            print "Missing key:", ipid
      else:
        cfg = json.load(open(fn))
        tdir = os.path.dirname(os.path.realpath(fn))
        force_compress = ('-z' in opts) or ('--compress' in opts)
        update_io(cfg, tdir, community, force_compress, filter=filter)
