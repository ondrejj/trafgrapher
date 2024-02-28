#!/usr/bin/python3 -S
# -*- coding: utf-8 -*-

'''
TrafGrapher collector

(c) 2015-2024 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Usage: tgc.py [--mkcfg|-c [community@]IP_or_hostname] \\
                [--entry Octets|Errors|Discards|] \\
		[--write|-w index.json] [--mkdir|-d] [--verbose|-v] \\
		[--filter ifOperStatus|ifAdminStatus] \\
		[--sensors-cisco|--sensors-huawei] \\
		[--id ifName] [--rename] [--backup] [--compress|-z] [--check]
       tgc.py [--verbose|-v] [community@]config.json \\
		[--filter-time=timestamp|datetime] \\
		[--filter-value=value=>value[kMGTP]] \\
		[--merge-dir=directory]
       tgc.py --ipset|--iptables|--nft \\
                [-q|--quiet] download_cmd upload_cmd
       tgc.py --netdev [filename|URL]
       tgc.py --hwmon /sys/class/hwmon
       tgc.py --files [-q|--quiet] file1 [file2 ...]
       tgc.py --cmd [-q|--quiet] cmd1 [cmd2 ...]

Examples:
  tgc -c public@10.0.0.1 -w index.json
  tgc index.json
  tgc index.json --filter-time='2015-07-04 02:00:00'
  tgc index.json --filter-value='>1T'
  tgc --ipset "ipset list acc_download" "ipset list acc_upload" [index_file]
  tgc --iptables "iptables -L acc_download -vxn" "iptables -L acc_upload -vxn"
  tgc --nft "nft -jN list set ip acc download" "nft -jN list set ip acc upload"
  tgc --netdev /proc/net/dev
'''

from __future__ import print_function

import sys
import os
import re
import fcntl
import socket
import time
import json
import getopt
import hashlib

if sys.version_info[0] > 2:  # python3
    long = int

VERBOSE = False
QUIET = False
BACKUP = False


def pp(x):
    return x.prettyPrint()


def ustr(x):
    '''Encode as UTF8 string.'''
    return (b"%s" % x).decode("utf8", "replace")


def macaddr(x):
    '''Format as MAC address.'''
    ret = []
    try:
        x = long(x.prettyPrint()[2:], 16)
    except ValueError:
        return x.prettyPrint()
    except TypeError:
        return x.prettyPrint()
    for i in range(6):
        ret.insert(0, "%02x" % (x % 256))
        x = x//256
    return ':'.join(ret)


def ifspeed(speed, unit="b/s"):
    '''Interface speed.'''
    k = 1000
    if speed==b"":
        return ""
    speed = long(speed)
    if (speed >= k**3):
        return "%d G%s" % (speed/k**3, unit)
    if (speed >= k**2):
        return "%d M%s" % (speed/k**2, unit)
    if (speed >= k):
        return "%d k%s" % (speed/k, unit)
    return "%d %s" % (speed, unit)


def ifhighspeed(speed):
    '''SNMP v2 interface speed.'''
    if not str(speed).isdigit():
        return None
    return ifspeed(long(speed)*1000000)


def from_ts(ts):
    '''Convert timestamp to standard formatted time.'''
    return time.strftime("%c", time.localtime(ts))


def fread(filename):
    if filename.startswith("http://") or filename.startswith("https://"):
        import ssl
        ctx = ssl._create_unverified_context()
        try:
            from urllib.request import urlopen
        except ImportError:
            from urllib2 import urlopen
        try:
            return urlopen(filename, context=ctx).read().decode("utf8").split("\n")
        except Exception as err:
            print(filename, err)
            return []
    return open(filename).read().split("\n")


IFTYPES = dict([(itx[1], itx[0]) for itx in [
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
    # return repr(iana['IANAifType'](ift)).split("'")[1]
    return IFTYPES.get(ift, 'UNKNOWN')


def ip2host(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except socket.herror:
        return ip
    except socket.gaierror:
        return ip


def safe_int(value):
    return int(value or 0)


oids_info = dict(
    ifIndex=str,
    ifDescr=str,
    ifName=str,
    ifAlias=ustr,
    ifType=iftype,
    ifMtu=safe_int,
    ifSpeed=ifspeed,
    # ifAdminStatus=safe_int,
    ifOperStatus=safe_int,
    # ifConnectorPresent=bool,
    ifHighSpeed=ifhighspeed,
    ifPhysAddress=macaddr
)

oids_sensor = [
    'entPhysicalDescr',
    'entSensorType',
    'entSensorScale',
    'entSensorPrecision',
    'entSensorValue'
]

OID_TABLE = dict(
    ifIndex="1.3.6.1.2.1.2.2.1.1",

    ifDescr="1.3.6.1.2.1.2.2.1.2",
    ifName="1.3.6.1.2.1.31.1.1.1.1",
    ifAlias="1.3.6.1.2.1.31.1.1.1.18",
    ifType="1.3.6.1.2.1.2.2.1.3",
    ifMtu="1.3.6.1.2.1.2.2.1.4",
    ifSpeed="1.3.6.1.2.1.2.2.1.5",
    ifHighSpeed="1.3.6.1.2.1.31.1.1.1.15",
    ifPhysAddress="1.3.6.1.2.1.2.2.1.6",
    ifAdminStatus="1.3.6.1.2.1.2.2.1.7",
    ifOperStatus="1.3.6.1.2.1.2.2.1.8",

    ifInOctets="1.3.6.1.2.1.2.2.1.10",
    ifOutOctets="1.3.6.1.2.1.2.2.1.16",
    ifInDiscards="1.3.6.1.2.1.2.2.1.13",
    ifOutDiscards="1.3.6.1.2.1.2.2.1.19",
    ifInErrors="1.3.6.1.2.1.2.2.1.14",
    ifOutErrors="1.3.6.1.2.1.2.2.1.20",

    ifHCInOctets="1.3.6.1.2.1.31.1.1.1.6",
    ifHCOutOctets="1.3.6.1.2.1.31.1.1.1.10",

    entPhysicalDescr="1.3.6.1.2.1.47.1.1.1.1.2",
    entPhysicalName="1.3.6.1.2.1.47.1.1.1.1.7",

    entSensorType="1.3.6.1.4.1.9.9.91.1.1.1.1.1",
    entSensorScale="1.3.6.1.4.1.9.9.91.1.1.1.1.2",
    entSensorPrecision="1.3.6.1.4.1.9.9.91.1.1.1.1.3",
    entSensorValue="1.3.6.1.4.1.9.9.91.1.1.1.1.4",

    hwEntityOpticalRxPower="1.3.6.1.4.1.2011.5.25.31.1.1.3.1.8"
)


class SNMP:
    port = 161
    sensor_datatypes = dict(enumerate(
        ",,,V,V,A,W,Hz,C,%,rpm,cmm,,,dBm".split(",")
    ))

    def __init__(self, addr, community_name="public"):
        # allow loading site-packages even for python -S
        import site
        site.main()
        from pysnmp.entity.rfc3413.oneliner import cmdgen
        self.MibVariable = cmdgen.MibVariable
        self.engine = cmdgen.CommandGenerator()
        self.addr = addr
        self.community = cmdgen.CommunityData(community_name)
        if ":" in addr:
            self.transport = cmdgen.Udp6TransportTarget(
                                 (addr, self.port), timeout=2, retries=2)
        else:
            self.transport = cmdgen.UdpTransportTarget(
                                 (addr, self.port), timeout=2, retries=2)

    def oid(self, prefix, suffix, *ids):
        if prefix == "" or suffix in OID_TABLE:
            if ids:
                return OID_TABLE.get(suffix, suffix) \
                    + "." + (".".join([str(x) for x in ids]))
            else:
                return OID_TABLE.get(suffix, suffix)
        return self.MibVariable(prefix, suffix, *ids)

    def get_data(self, prefix, oids):
        errorIndication, errorStatus, errorIndex, varBindTable = \
            self.engine.nextCmd(
                self.community,
                self.transport,
                *[self.oid(prefix, x) for x in oids]
            )
        if errorIndication:
            print("%s: %s" % (self.addr, errorIndication))
        elif errorStatus:
            print('%s at %s' % (
                errorStatus.prettyPrint(),
                errorIndex and varBindTable[-1][int(errorIndex)-1] or '?'
            )
            )
        else:
            return varBindTable
        return []

    def get_info(self, ifid='ifIndex', log_prefix=None, oids=oids_info,
                 filter=None):
        if filter:
            oids[filter] = int
        ret = {}
        for row in self.get_data("IF-MIB", oids):
            data = dict([
                (x[0].replace("ifHC", "if"), oids[x[0]](x[1][1]))
                for x in zip(oids, row)
            ])
            # check IO retrieval
            ifindex = data['ifIndex']
            if ifindex.startswith('-'):
                # fix broken negative values for Huawei
                ifindex = str(2**32+long(ifindex))
            io = self.getall([ifindex])
            if data.get("ifName", "") == "Nu0":
                continue  # ignore Null interfaces
            if io[ifindex]['error']:
                print("Unable to get 64bit IO for id %s [%s], trying 32bit ..."
                      % (ifindex, data.get("ifName", "")))
                io = self.getall([ifindex], only32bit=True)
                if io[ifindex]['error']:
                    print("Unable to get IO for id %s [%s], ignoring ..."
                          % (ifindex, data.get("ifName", "")))
                    if VERBOSE:
                        print(data)
                        print(io)
                    continue
                else:
                    data["_counter_size"] = 32
            # ignored types and names
            if 'ifType' in data and data['ifType'] == 'ieee8023adLag':
                if ('ifSpeed' not in data) or data['ifSpeed'].startswith("0"):
                    continue
            # ignore interfaces, which are not present (unreachable stack ports ...)
            if data['ifOperStatus'] == 6:  # interface not present
                #print("Interface not present: %s" % data["ifName"])
                continue
            # use HighSpeed if possible
            if 'ifHighSpeed' in data:
                if data['ifHighSpeed'] is not None:
                    data['ifSpeed'] = data['ifHighSpeed']
                del data['ifHighSpeed']
            if log_prefix is not None:
                # append to log
                data['log'] = "%s_%s.log" % (log_prefix,
                                             data[ifid].lower().replace(
                                                 "/", "_")
                                             )
            # remove filtering status
            if filter in data:
                if data[filter] != 1:  # !UP
                    continue
                del data[filter]
            if data['ifName'] != 'Nu0':
                ret[ifindex] = data
        return ret

    def get_sensors_cisco(self):
        ret = {}
        receive_sensor_string = " Receive Power Sensor"
        infos = dict(
            (x['ifDescr'], x)
            for x in self.get_info().values()
        )
        for row in self.get_data("", oids_sensor[:1]):
            if str(row[0][1]).endswith(receive_sensor_string):
                id = row[0][0].asTuple()[-1]
                interface = str(row[0][1]).replace(receive_sensor_string, "")
                datatype, scale, precision, value \
                    = self.getsome("", oids_sensor[1:], [id])
                scale = 1000**(float(scale)-9)
                precision = 10**float(precision)
                #value = float(value)*scale/precision
                ret[self.oid("", oids_sensor[-1], id)] = dict(
                    log="%s_%s.log" % (self.addr, id),
                    unit=self.sensor_datatypes.get(int(datatype), ""),
                    scale=scale/precision,
                    force_bytes=True,  # do not multiply by 8
                    description=interface,
                    name=interface,
                    **infos.get(interface, {})  # update with interface info
                )
        return ret

    def get_key_value(self, prefix, type=str, reverse=False):
        if reverse:
            return dict([
                (str(x[0][1]), x[0][0][-1])
                for x in self.get_data("", {prefix: type})
            ])
        else:
            return dict([
                (x[0][0][-1], str(x[0][1]))
                for x in self.get_data("", {prefix: type})
            ])

    def get_sensors_huawei(self):
        ret = {}
        infos = dict(
            (x['ifDescr'], x)
            for x in self.get_info().values()
        )
        names = self.get_key_value("entPhysicalName")
        power = self.get_key_value("hwEntityOpticalRxPower")
        for id, interface in names.items():
            if id not in power:
                continue  # ignore missing
            #value = float(power.get(id))/100
            ret[OID_TABLE["hwEntityOpticalRxPower"]+'.'+str(id)] = dict(
                log="%s_%s.log" % (self.addr, id),
                unit="dBm",
                scale=0.01,
                force_bytes=True,  # do not multiply by 8
                #replaces = [[-1, None]],
                description=infos.get(interface, {}).get("ifAlias", interface),
                name=interface,
                **infos.get(interface, {})  # update with interface info
            )
        return ret

    def get_uptime(self):
        errorIndication, errorStatus, errorIndex, varBindTable = \
            self.engine.nextCmd(
                self.community, self.transport,
                self.MibVariable(
                    'SNMPv2-MIB', 'sysUpTime'
                )
            )
        if not varBindTable:
            print("%s: %s" % (self.addr, errorIndication))
            return None
        return float(varBindTable[0][0][1])/100

    def getblock(self, request, prefix, ifs, suffix="Octets"):
        ret = {}
        result = self.getsome(
            "IF-MIB",
            [prefix+"In"+suffix, prefix+"Out"+suffix],
            request
        )
        for id in request:
            try:
                ino = result.pop(0)
                outo = result.pop(0)
                ret[id] = {
                    "ifIn"+suffix: long(ino),
                    "ifOut"+suffix: long(outo),
                    "error": None
                }
            except (AttributeError, IndexError, ValueError, TypeError) as err:
                ret[id] = {
                    "ifIn"+suffix: None,
                    "ifOut"+suffix: None,
                    "error": "No such instance: ip: %s:%d, id: %s [%s]"
                             % (self.addr, self.port, id,
                                ifs.get(id, {}).get("ifName", ""))
                }
        return ret

    def getall(self, ids, ifs={}, suffix="Octets", n=8, only32bit=False):
        ret = {}
        if ids:
            request = {"ifHC": [], "if": []}
            while ids:
                # override to 32bit, if configured
                if only32bit or ifs.get(ids[0], {}).get("_counter_size", 0) == 32 \
                        or suffix!="Octets":
                    prefix = "if"
                else:
                    prefix = "ifHC"
                request[prefix].append(ids.pop(0))
                if len(request[prefix]) >= n:
                    ret.update(
                        self.getblock(request[prefix], prefix, ifs, suffix=suffix)
                    )
                    request[prefix] = []
            for prefix in ["ifHC", "if"]:
                if request[prefix]:
                    ret.update(
                        self.getblock(request[prefix], prefix, ifs, suffix=suffix)
                    )
        return ret

    def getsome(self, prefix="", suffixes=[], ids=[]):
        from pysnmp.carrier.error import CarrierError
        mibvars = []
        if ids:
            for id in ids:
                mibvars.extend([
                    self.oid(prefix, suffix, int(id))
                    for suffix in suffixes
                ])
        else:
            mibvars.extend([
                self.oid(prefix, str(suffix))
                for suffix in suffixes
            ])
        try:
            errorIndication, errorStatus, errorIndex, varBinds = self.engine.getCmd(
                self.community,
                self.transport,
                *mibvars
            )
        except CarrierError as err:
            print("%s: %s" % (self.addr, err))
            return []
        if errorIndication:
            print("%s: %s" % (self.addr, errorIndication))
            return []
        elif errorStatus:
            print('%s at %s' % (
                errorStatus.prettyPrint(),
                errorIndex and varBinds[-1][int(errorIndex)-1] or '?'
            )
            )
            return []
        ret = []
        try:
            vars = dict(varBinds)
            svars = dict([(str(x[0]), x[1]) for x in vars.items()])
            for key in mibvars:
                if key in vars:
                    ret.append(vars[key])
                if key in svars:
                    ret.append(svars[key])
        except AttributeError as err:
            print(err.args[0], id)
        return ret


class grouper(dict):
    one_day = 24*3600
    compress_intervals = {
        600: 1,
        3*one_day: 300,  # 5 min
        14*one_day: 900,  # 15 min
        62*one_day: 1800,  # 1/2 hours
        int(4*365.25*one_day): one_day/4  # 1/4 day
    }

    def __getitem__(self, key):
        if not key in self:
            self[key] = []
        return dict.__getitem__(self, key)

    def items(self, fx=['avg', 'avg', max, max]):
        ret = []
        for key, values in dict.items(self):
            vals = []
            for id, func in enumerate(fx):
                try:
                    not_none = [x[id] for x in values if x[id] is not None]
                except IndexError:
                    print("Wrong data from log file")
                    # clear current vals and ignore whole row
                    vals = []
                    continue
                if not not_none:
                    vals.append(None)
                elif func == "avg":
                    vals.append(sum(not_none)/len(not_none))  # avg
                else:
                    vals.append(func(not_none))
            if vals:
                ret.append((key, vals))
        return ret

    def load(self, deltas, start=None):
        if start is None:
            start = max(deltas.keys())
        intervals = list(self.compress_intervals.items())
        limit = None
        for t in sorted(deltas, reverse=True):
            if limit is None or start-t >= limit:
                if intervals:
                    limit, range = intervals.pop(0)
                else:
                    break
            st = int(t/range)*range
            self[st].append(deltas[t])
        return self


class LockError(Exception):
    pass


class logfile:
    header_format = "%010d %020d %020d\n"
    header_length = len(header_format % (0, 0, 0))
    data_format = "%d %d %d %d %d\n"

    def __init__(self, filename, force_compress=False):
        self.filename = filename
        self.deltas = {}
        try:
            # binary mode required to allow seeking
            self.f = self.open(self.filename, "rb+")
            counter = self.f.readline()
            if counter:
                counter_split = counter.split(b" ")
                if counter_split[0].isdigit():
                    self.counter = (
                        long(counter_split[0]),
                        self.data_type(counter_split[1]),
                        self.data_type(counter_split[2])
                    )
                    if self.counter[0]//grouper.one_day != time.time()//grouper.one_day:
                        # next day, force compress
                        force_compress = True
                else:
                    bkp_filename = filename + \
                        time.strftime(".backup-%Y%m%d-%H%M%S")
                    print(
                        "ERROR: Unable to parse logfile. Made a backup to %s and recovering." % bkp_filename)
                    os.rename(filename, bkp_filename)
                    self.f = self.open(self.filename, "wb")
                    self.counter = ()
            else:
                self.counter = ()
            if len(counter) != self.header_length:
                # load deltas and convert this file from MRTG to trafgrapher
                print("Converting file:", self.filename)
                self.load(self.f)
            elif force_compress:
                #print("Compress:", self.filename)
                self.load(self.f)
        except IOError:
            self.f = self.open(self.filename, "wb")
            self.counter = ()

    def open(self, filename, mode):
        f = open(filename, mode)
        try:
            # do not use LOCK_NB, wait until file is unlocked to avoid errors
            fcntl.flock(f, fcntl.LOCK_EX)
        except IOError:
            raise LockError("ERROR: File locked: %s!" % filename)
        return f

    def data_type(self, value):
        if value == "N" or value == "None" or value == b"N" or value == b"None":
            return None
        return long(value, 10)

    def update_valid(self, value, rowid=None):
        if value:
            try:
                self.update(self.data_type(value))
            except ValueError:
                print(
                    "Could not convert value to float: '%s', id %s"
                    % (value, rowid)
                )

    def store_value(self, value):
        if value is None:
            return "N"
        return value

    def load(self, f):
        max_time = time.time() + 3600*24  # anything beyond 1 day from now
        for row in f.readlines():
            row = row.rstrip()
            if row:
                row_split = row.split(b" ", 4)
                try:
                    t = long(row_split[0])
                    if t > max_time:
                        print("Time from future ignored: %s: %d" %
                              (self.filename, t))
                        continue
                    self.deltas[t] = tuple(self.data_type(x)
                                           for x in row_split[1:])
                except ValueError as err:
                    print("Error loading logfile: %s" % err)
                    print("Ignoring row: '%s'" % row)

    def header(self):
        return (self.header_format % self.counter).encode("utf8")

    def save(self, delta=None):
        if self.deltas:
            # save data when converting to new format
            #print("Full save:", self.filename)
            # rename old file, do not close it to leave it locked
            old_f = self.f
            if delta is not None:
                self.deltas[delta[0]] = delta[1:]  # add current values
            self.compress()
            self.f = self.open(self.filename+'.tmp', "wb")
            if self.header_format:
                self.f.write(self.header())
            for t in sorted(self.deltas, reverse=True):
                self.f.write((self.data_format
                              % tuple([t]+[self.store_value(x) for x in self.deltas[t]])
                              ).encode("utf8"))
            self.f.close()
            if BACKUP:
                os.rename(self.filename, self.filename+"~")
            os.rename(self.filename+'.tmp', self.filename)
            old_f.close()  # close old file after rename
        else:
            # Avoid change length of header here.
            # Update header only when does not change it's length or on full save!
            if self.header_format:
                header = self.header()
                if len(header) == self.header_length:
                    self.f.seek(0)
                    self.f.write(header)
            self.f.seek(0, 2)  # EOF
            self.f.write((self.data_format % delta).encode("utf8"))
            self.f.close()

    def update(self, data_in, data_out,
               gauge_in=False, gauge_out=False,
               uptime=None, counter_bits=None):
        '''
        Update with current values
        '''
        # t = long(time.mktime(time.gmtime())) # UTC time
        t = long(time.time())  # Local time
        delta_t = 1
        delta_in = 0
        delta_out = 0
        if self.counter:
            delta_t = t - self.counter[0]
            if delta_t == 0:
                # ignore, no delta time, avoid division by zero
                return
            if self.counter[1] <= data_in:
                delta_in = data_in-self.counter[1]
            elif counter_bits and uptime is not None and delta_t < uptime:
                delta_in = 2**counter_bits - self.counter[1] + data_in
            if self.counter[2] <= data_out:
                delta_out = data_out-self.counter[2]
            elif counter_bits and uptime is not None and delta_t < uptime:
                delta_out = 2**counter_bits - self.counter[2] + data_out
        delta_in_pt = delta_in/delta_t
        delta_out_pt = delta_out/delta_t
        if gauge_in:
            delta_in_pt = data_in
        if gauge_out:
            delta_out_pt = data_out
        delta = (t, delta_in_pt, delta_out_pt, delta_in_pt, delta_out_pt)
        # if delta_in_pt>12**8 or delta_out_pt>12**8 \
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

    def merge(self, filename):
        file2 = self.open(filename, "rb+")
        header2 = file2.readline()  # read header
        if int(header2.split(b" ", 1)[0])>int(self.counter[0]):
          self.header = header2
        self.load(file2)

    def filter_time(self, filter):
        '''
        Filter out data by time
        '''
        if not filter:
            return self
        self.load(self.f)
        for key in filter.split(","):
            key = int(key)
            if key in self.deltas:
                print("Filtered: %s: %s" % (
                    from_ts(key),
                    ", ".join([str(x) for x in self.deltas[key]]))
                )
                del self.deltas[key]
        return self

    def unit_si(self, value):
        units = dict(k=1024, m=1024**2, g=1024**3, t=1024**4, p=1024**5)
        for unit, multiply in units.items():
            if value[-1].lower() == unit:
                return long(value[:-1])*multiply
        return long(value)

    def filter_value(self, filter):
        '''
        Filter out data by value
        '''
        if not filter:
            return self
        self.load(self.f)
        if filter.startswith("="):
            value = self.unit_si(filter[1:])
            for key in self.deltas.keys():
                for vx in self.deltas[key]:
                    if vx == value:
                        print("Filtered value: %s - %s" % (from_ts(key), vx))
                        del self.deltas[key]
                        break
        elif filter.startswith(">"):
            value = self.unit_si(filter[1:])
            for key in list(self.deltas.keys()):
                for vx in self.deltas[key]:
                    if vx is not None and vx > value:
                        print("Filtered value: %s - %s" % (from_ts(key), vx))
                        del self.deltas[key]
                        break
        elif filter.startswith("<"):
            value = self.unit_si(filter[1:])
            for key in self.deltas.keys():
                for vx in self.deltas[key]:
                    if vx is not None and vx < value:
                        print("Filtered value: %s - %s" % (from_ts(key), vx))
                        del self.deltas[key]
                        break
        else:
            print("Ignoring unknown filter: %s" % filter)
        return self


class logfile_simple(logfile):
    # header: host service value unit
    header_format = "%s\t%s\t%s\t%s\n"
    data_format = "%d %s\n"

    def __init__(self, filename, header, force_compress=False):
        self.filename = filename
        self.header_data = header
        self.deltas = {}
        try:
            mtime = os.stat(self.filename).st_mtime
            # binary mode required to allow seeking
            self.f = self.open(self.filename, "rb+")
            header = self.f.readline()  # read header
            if mtime//grouper.one_day < time.time()//grouper.one_day:
                force_compress = True
            if force_compress:
                self.load(self.f)
        except OSError:
            self.f = self.open(self.filename, "wb")
            self.f.write(self.header())

    def data_type(self, value):
        if value == "N" or value == "None" or value == b"N" or value == b"None":
            return None
        return float(value)

    def header(self):
        return (self.header_format % self.header_data).encode("utf8")

    def update(self, value):
        '''
        Update with current value
        '''
        ts = long(time.time())  # Local time
        delta = (ts, value)
        self.save(delta)

    def compress(self):
        '''
        Compress data
        '''
        grp = grouper()
        grp.load(self.deltas)
        self.deltas = dict(grp.items(['avg']))


def update_io(cfg, tdir, community_name="public", suffix="Octets",
              force_compress=False,
              filter_time=None, filter_value=None):
    ids = list(cfg['ifs'].keys())
    IP = cfg['ip']
    snmpc = SNMP(IP, community_name)
    uptime = snmpc.get_uptime()
    if uptime is None:
        return
    for idx, io in snmpc.getall(ids, ifs=cfg['ifs'], suffix=suffix).items():
        if io['error']:
            print(io['error'])
            if VERBOSE:
                print(json.dumps(cfg['ifs'][idx],
                                 indent=2, separators=(',', ': ')))
        else:
            try:
                logfile(
                    os.path.join(tdir, cfg['ifs'][idx]['log']),
                    force_compress
                ).filter_time(
                    filter_time
                ).filter_value(
                    filter_value
                ).update(
                    io['ifIn'+suffix], io['ifOut'+suffix],
                    uptime=uptime,
                    counter_bits=cfg['ifs'][idx].get('counter_bits', 64)
                )
            except LockError as err:
                print(err)


def update_value(cfg, tdir, community_name="public", force_compress=False,
                 filter_time=None, filter_value=None):
    ids = list(cfg['oids'].keys())
    IP = cfg['ip']
    snmpc = SNMP(IP, community_name)
    vals = snmpc.getsome("", cfg['oids'].keys())
    for val, data in zip(vals, cfg['oids'].values()):
        #print(float(val)*data['scale'], data)
        replaces = dict(data.get("replaces", []))
        if val in replaces:
            val = replaces[val]
        if val is None or val == "" or val == b"":
            continue
        try:
            logfile_simple(
                os.path.join(tdir, data['log']),
                (cfg.get('name', IP), 'receive_power',
                    data['name'], data['unit']),
                force_compress
            ).filter_time(
                filter_time
            ).filter_value(
                filter_value
            ).update(
                float(val)*data['scale']
            )
        except LockError as err:
            print(err)


def merge_logfiles(cfg, target_dir, merge_dir):
    for data in cfg['ifs'].values():
        print("Merge:", data["log"])
        try:
            lf = logfile(
                     os.path.join(target_dir, data['log']),
                     force_compress=True
                 )
            lf.merge(os.path.join(merge_dir, data['log']))
            lf.save()
        except LockError as err:
            print(err)


def read_file(filename, row_name, column):
    for row in open(filename, "r").readlines():
        row = row.strip().split()
        if row[0] == row_name:
            try:
                return int(row[column])
            except ValueError as err:
                sys.exit("ERROR: Unable to parse value: "+str(err.args[0]))
    return 0


def read_uptime(filename=None):
    if not filename:
        return None
    uptime = open(filename, "r").readline().strip().split(" ", 1)
    if not uptime[0]:
        sys.exit("ERROR: Unable to read uptime (empty string).")
    try:
        return float(uptime[0])
    except ValueError as err:
        sys.exit("ERROR: Unable to parse uptime value: "+str(err.args[0]))


def update_local(cfg, tdir, force_compress=False,
                 filter_time=None, filter_value=None):
    for key, value in cfg['ifs'].items():
        try:
            logfile(
                os.path.join(tdir, value['log']),
                force_compress
            ).filter_time(
                filter_time
            ).filter_value(
                filter_value
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
        except LockError as err:
            print(err)


# ipset, iptables and nftables counters for firewall accounting


class fwcounter_base():
    cmd = ""  # redefined in subclass

    def __init__(self, cmd):
        self.cmd = cmd

    def read(self):
        self.bytes = {}
        self.packets = {}
        return os.popen(self.cmd).readlines()


class ipset(fwcounter_base):
    type = "ipset"

    def items(self):
        for row in self.read():
            if ' packets ' in row and ' bytes ' in row:
                cols = row.strip().replace("[", "").replace("]", "").split(" ")
                self.bytes[cols[0]] = int(cols[4])
                self.packets[cols[0]] = int(cols[2])
                yield cols[0], int(cols[4]), int(cols[2])


class iptables_src(fwcounter_base):
    type = "iptables"
    ip_column = -2

    def items(self):
        # skip first 2 rows of header
        for row in self.read()[2:]:
            cols = row.strip().split()
            self.bytes[cols[self.ip_column]] = int(cols[1])
            self.packets[cols[self.ip_column]] = int(cols[0])
            yield cols[self.ip_column], int(cols[1]), int(cols[0])


class iptables_dst(iptables_src):
    ip_column = -1


class nftables_set(fwcounter_base):
    type = "nftables"

    def read(self):
        self.bytes = {}
        self.packets = {}
        return json.loads(os.popen(self.cmd).read().encode("utf-8"))

    def items(self):
        elems = self.read()['nftables'][1]['set']['elem']
        for elem in elems:
            ip = elem["elem"]["val"]
            cnt = elem["elem"]["counter"]
            if type(ip)==dict:
                ip = "%s/%d" % (ip["prefix"]["addr"], ip["prefix"]["len"])
            self.bytes[ip] = cnt["bytes"]
            self.packets[ip] = cnt["packets"]
            yield ip, cnt["bytes"], cnt["packets"]


def files_mkindex(files):
    cfg = dict(
        ip=socket.gethostbyname(socket.gethostname()),
        name=socket.gethostname(),
        cmd_type="files",
        ifs={}
    )
    for cmdid, fn in enumerate(files):
        safe_fn = fn.strip("/").replace("/", "_")
        cfg["ifs"][safe_fn] = dict(
            file=fn,
            ifDescr=fn,
            log=safe_fn+".log"
        )
    return cfg


def cmd_mkindex(cmds):
    cfg = dict(
        ip=socket.gethostbyname(socket.gethostname()),
        name=socket.gethostname(),
        cmd_type="sh",
        ifs={}
    )
    for cmdid, cmd in enumerate(cmds):
        descr = "%d:%s" % (cmdid, cmd)
        md5 = hashlib.md5(descr.encode("utf-8")).hexdigest()
        cfg["ifs"][cmdid] = dict(
            cmd=cmd,
            ifDescr=descr,
            log=md5+".log"
        )
    return cfg


def fwcounter_mkindex(name, ip, parser_src, parser_dst):
    cfg = dict(
        ip=ip,
        name=name,
        cmd_type=parser_src.type,
        cmd_src=parser_src.cmd,
        cmd_dst=parser_dst.cmd,
        ifs={}
    )
    ips = sorted(
        set([x[0] for x in parser_src.items()])
        &
        set([x[0] for x in parser_dst.items()])
    )
    for ip in ips:
        ipid = ip.replace("/", "_")
        cfg["ifs"][ipid] = dict(
            ifIndex=ipid,
            ifName=ip,
            ifAlias=ip2host(ip),
            ifDescr=ip,
            log=ipid+'.log'
        )
    return cfg


class pid_cpu_usage():
    def __init__(self):
        self.ticks = float(os.sysconf(os.sysconf_names["SC_CLK_TCK"]))
        self.load_pids()

    def load_pids(self):
        self.pid_stats = {}
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                cmd = open(
                    os.path.join("/proc", pid, "cmdline"), "r"
                ).read().replace("\x00", " ")
                stat = open(
                    os.path.join("/proc", pid, "stat"), "r"
                ).read().split(" ")
            except IOError:
                continue
            self.pid_stats[cmd] = stat

    def cpu_usage(self, reg_name):
        for cmd, stat in self.pid_stats.items():
            name = re.compile(reg_name).search(cmd)
            if name:
                return [int(x) for x in stat[13:17]]


class proc_net_dev(fwcounter_base):
    cmd = "netdev"

    def __init__(self, direction="rx", filename="/proc/net/dev"):
        self.filename = filename
        self.direction = direction

    def read(self):
        self.bytes = {}
        self.packets = {}
        rows = fread(self.filename)
        if not rows:
            self.shift = 0
            return []
        # ignore header rows
        self.col_names = dict([
            (x[1], x[0])
            for x in enumerate(rows[1].split("|")[1].split())
        ])
        self.rx_shift = 1
        self.tx_shift = self.rx_shift + len(self.col_names)
        if self.direction == "tx":
            self.shift = self.tx_shift
        else:
            self.shift = self.rx_shift
        return rows[2:]

    def items(self):
        for row in self.read():
            cols = row.strip().replace(":", " ").split()
            if cols:
                cols[0] = cols[0]
                self.bytes[cols[0]] = int(
                    cols[self.shift+self.col_names["bytes"]])
                self.packets[cols[0]] = int(
                    cols[self.shift+self.col_names["packets"]])
                yield cols[0], self.bytes[cols[0]], self.packets[cols[0]]

    def mkindex(self):
        cfg = dict(
            ip=socket.gethostbyname(socket.gethostname()),
            name=socket.gethostname(),
            cmd_type="netdev",
            net_dev_filename=self.filename,
            ifs={}
        )
        for iface_nr, (iface_name, bytes, packets) in enumerate(self.items()):
            cfg["ifs"][iface_nr] = dict(
                index=iface_nr,
                ifName=iface_name,
                ifDescr=iface_name,
                log="%s.log" % iface_name
            )
        return cfg


class sys_class_hwmon(fwcounter_base):
    cmd = "hwmon"

    def __init__(self, dir="/sys/class/hwmon"):
        self.dir = dir

    def mkindex(self):
        cfg = dict(
            ip=socket.gethostbyname(socket.gethostname()),
            name=socket.gethostname(),
            cmd_type="files",
            ifs={}
        )
        for hwmon in os.listdir(self.dir):
            dev_dir = os.path.join(self.dir, hwmon)
            name = open(os.path.join(dev_dir, "name")).read().strip()
            for i in range(1, 99):
                file_prefix = os.path.join(dev_dir, "temp%d_" % i)

                def read(what, type=float):
                    if os.path.exists(file_prefix+what):
                        content = open(file_prefix+what).read().strip()
                        if what == "label":
                            return content
                        if type == float:
                            return float(content)/1000.0
                        return content
                    return None
                value = read("input")
                if value is None:
                    break
                label = read("label")
                cfg["ifs"]["%s_%d" % (hwmon, i)] = dict(
                    ifName="%s_temp%s" % (hwmon, i),
                    ifDescr="%s: %s" % (name, label or i),
                    log="%s_temp%s.log" % (hwmon, i),
                    file=os.path.join(dev_dir, "temp%d_input" % i),
                    unit="m℃"
                )
        return cfg


def process_configs(files):
    filter_time = filter_value = ""
    if "--filter-time" in opts:
        filter_time = opts["--filter-time"]
        if ':' in filter_time:
            # convert date and time format to timestamps
            filter_time = ",".join([
                "%d" % time.mktime(time.strptime(x, "%Y-%m-%d %H:%M:%S"))
                for x in filter_time.split(",")
            ])
    if "--filter-value" in opts:
        filter_value = opts["--filter-value"]
    force_compress = ('-z' in opts) or ('--compress' in opts)
    entry = opts.get("--entry", "Octets")
    for fn in files:
        if '@' in fn:
            community, fn = fn.split('@', 1)
        else:
            community = 'public'
        if not os.path.exists(fn):
            print("Configuration file doesn't exist [%s]!" % fn)
            continue
        # update env
        if "PATH" in os.environ:
            os.environ["PATH"] += ":/sbin:/usr/sbin"
        # load config
        cfg = json.load(open(fn))
        prefix = os.path.dirname(fn)
        if "prefix" in cfg:
            prefix = cfg["prefix"]
        ps = pd = None
        if "--local" in opts:
            tdir = os.path.dirname(os.path.realpath(fn))
            update_local(
                cfg, tdir, force_compress,
                filter_time=filter_time, filter_value=filter_value
            )
        elif "--merge-dir" in opts:
            tdir = os.path.dirname(os.path.realpath(fn))
            merge_logfiles(cfg, tdir, opts["--merge-dir"])
            sys.exit()
        elif "cmd_type" in cfg:
            if cfg["cmd_type"] == "sh":
                for rowid, row in cfg["ifs"].items():
                    value = os.popen(row["cmd"]).read().strip()
                    try:
                        lf = logfile_simple(
                            os.path.join(prefix, row["log"]),
                            (row["cmd"], "-", "-", row.get("unit", "-")),
                            force_compress=force_compress
                        ).filter_time(filter_time).filter_value(filter_value)
                        lf.update_valid(value)
                    except LockError as err:
                        print(err)
            elif cfg["cmd_type"] == "ipset":
                ps = ipset(cfg["cmd_src"])
                pd = ipset(cfg["cmd_dst"])
            elif cfg["cmd_type"] == "iptables":
                ps = iptables_dst(cfg["cmd_dst"])
                pd = iptables_src(cfg["cmd_src"])
            elif cfg["cmd_type"] == "nftables":
                ps = nftables_set(cfg["cmd_dst"])
                pd = nftables_set(cfg["cmd_src"])
            elif cfg["cmd_type"] == "netdev":
                ps = proc_net_dev("rx", cfg["net_dev_filename"])
                pd = proc_net_dev("tx", cfg["net_dev_filename"])
            elif cfg["cmd_type"] == "files":
                max_age = int(cfg.get("max_age", 0))
                for cmd_name, cmd in cfg["ifs"].items():
                    try:
                        if "file" in cmd:
                            if max_age > 0:
                                file_age = time.time() - \
                                    os.stat(os.path.join(
                                        prefix, cmd["file"])).st_mtime
                                if file_age > max_age:
                                    print("Data file %s older than %d seconds for '%s'."
                                          % (cmd["file"], file_age, cmd.get("ifDescr", "")))
                                    continue
                            fc = open(os.path.join(prefix, cmd["file"])
                                      ).read().strip()
                            if fc:
                                lf = logfile_simple(
                                    os.path.join(prefix, cmd["log"]),
                                    (cmd["file"], "-", "-", "-"),
                                    force_compress=force_compress
                                ).filter_time(filter_time).filter_value(filter_value)
                                lf.update_valid(open(os.path.join(prefix, cmd["file"])
                                                    ).read().strip())
                        elif "file2" in cmd:
                            if max_age > 0:
                                file_age = time.time() - \
                                    os.stat(os.path.join(
                                        prefix, cmd["file"])).st_mtime
                                if file_age > max_age:
                                    print("Data file %s older than %d seconds for '%s'."
                                          % (cmd["file"], file_age, cmd.get("ifDescr", "")))
                                    continue
                            fc = open(os.path.join(prefix, cmd["file2"])
                                      ).read().strip().split()
                            if fc:
                                lf = logfile(os.path.join(prefix, cmd["log"])
                                             ).filter_time(filter_time).filter_value(filter_value)
                                ps, pd = [
                                    float(x)
                                    for x in open(os.path.join(prefix, cmd["file2"])
                                                  ).read().strip().split()
                                ]
                                lf.update(ps, pd)
                    except LockError as err:
                        print(err)
            elif cfg["cmd_type"] == "key_value":
                data = dict([x.split(": ", 1) for x in fread(cfg["data_url"]) if ": " in x])
                for rowid, row in cfg["ifs"].items():
                    value = data[row["data_key"]]
                    try:
                        lf = logfile_simple(
                            os.path.join(prefix, row["log"]),
                            (row["data_key"], "-", "-", row.get("unit", "-")),
                            force_compress=force_compress
                        ).filter_time(filter_time).filter_value(filter_value)
                        lf.update_valid(value)
                    except LockError as err:
                        print(err)
            elif cfg["cmd_type"] == "pid_cpu_usage":
                usages = pid_cpu_usage()
                for cmd_name, cmd in cfg["ifs"].items():
                    try:
                        lf = logfile(os.path.join(prefix, cmd["log"]))
                        usage = usages.cpu_usage(cmd["re_cmd"])
                        if usage:
                            lf.update(usage[2]+usage[3], usage[0]+usage[1])
                    except LockError as err:
                        print(err)
            else:
                print("Unknown command type:", cfg["cmd_type"])
            if ps and pd:
                list(ps.items()), list(pd.items())  # load object
                for ip in cfg["ifs"].values():
                    ipid = ip['ifName']
                    #print(ip['ifName'], pd.bytes[ipid], ps.bytes[ipid])
                    try:
                        lf = logfile(os.path.join(prefix, ip['log'])
                                     ).filter_time(filter_time).filter_value(filter_value)
                        if ipid in pd.bytes and ipid in ps.bytes:
                            lf.update(pd.bytes[ipid], ps.bytes[ipid])
                        elif not QUIET:
                            print("Missing key:", ipid)
                    except LockError as err:
                        print(err)
        else:
            tdir = os.path.dirname(os.path.realpath(fn))
            if 'ifs' in cfg:
                update_io(
                    cfg, tdir, community, suffix=cfg.get("entry", entry),
                    force_compress=force_compress,
                    filter_time=filter_time, filter_value=filter_value
                )
            elif 'oids' in cfg:
                update_value(
                    cfg, tdir, community, force_compress=force_compress,
                    filter_time=filter_time, filter_value=filter_value
                )
            else:
                print("Missing ifs or oids in cfg file!")


if __name__ == "__main__":
    opts, files = getopt.gnu_getopt(sys.argv[1:], 'hctzw:dvq',
                    ['help', 'mkcfg', 'test', 'write=',
                     'mkdir', 'id=', 'rename',
                     'verbose', 'quiet', 'check', 'backup',
                     'merge-dir=', 'filter=', 'filter-time=', 'filter-value=',
                     'local', 'entry=', 'sensors-cisco', 'sensors-huawei',
                     'iptables', 'ipset', 'nft',
                     'netdev', 'hwmon', 'files', 'cmd'])
    opts = dict(opts)
    if "--verbose" in opts or "-v" in opts:
        VERBOSE = True
    elif "--quiet" in opts or "-q" in opts:
        QUIET = True
    if "--backup" in opts:
        BACKUP = True
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
            dns_name = socket.gethostbyaddr(name)[0]
        except:
            dns_name = name
        if "--id" in opts:
            ifid = opts["--id"]
        else:
            ifid = "ifIndex"
        if "--filter" in opts:
            iffilter = opts["--filter"]
        else:
            iffilter = None
        if dns_name == log_prefix:
            print("Connecting to: %s@%s" % (community, name))
        else:
            print("Connecting to: %s@%s [%s]" % (community, name, log_prefix))
        ret = {}
        if "--entry" in opts:
            ret["entry"] = opts["--entry"]
        if "--sensors-cisco" in opts:
            result = SNMP(name, community).get_sensors_cisco()
            ret['oids'] = result
        elif "--sensors-huawei" in opts:
            result = SNMP(name, community).get_sensors_huawei()
            ret['oids'] = result
        else:
            result = SNMP(name, community).get_info(
                ifid, log_prefix, filter=iffilter)
            ret['ifs'] = result
        try:
            dns_ip = socket.gethostbyname(dns_name)
        except socket.gaierror:
            dns_ip = name
        ret = json.dumps(
            dict(name=dns_name, ip=dns_ip, **ret),
            indent=2, separators=(',', ': ')
        )
        if "--write" in opts:
            out_filename = opts["--write"]
            dirname = os.path.dirname(out_filename)
        elif "-w" in opts:
            out_filename = opts["-w"]
            dirname = os.path.dirname(out_filename)
        else:
            out_filename = ""
            print(ret)
            dirname = "."
        if "--rename" in opts:
            if not out_filename:
                print("ERROR: --write filename required for --rename option")
                sys.exit(1)
            rename_from = json.load(open(out_filename))
        if result:
            if "--check" in opts:
                for key, value in result.items():
                    if not os.path.exists(os.path.join(dirname, value['log'])):
                        print("Missing log file: %s" % value['log'])
            if out_filename:
                if "--rename" in opts:
                    rename_from = json.load(open(out_filename))
                    for id in result:
                        old_name = rename_from['ifs'][id]['log']
                        if os.path.exists(old_name) and not os.path.exists(result[id]['log']):
                            print("Rename: %s -> %s" %
                                  (old_name, result[id]['log']))
                            os.rename(old_name, result[id]['log'])
                if os.path.exists(out_filename):
                    os.rename(out_filename, out_filename+".old")
                if "--mkdir" in opts or "-d" in opts:
                    if not os.path.isdir(dirname):
                        print("Creating missing directory: %s" % dirname)
                        os.makedirs(dirname)
                open(out_filename, "wt").write(ret)
                print("Update command: %s %s@%s"
                      % (sys.argv[0], community, out_filename))
    elif "--ipset" in opts:
        cfg = fwcounter_mkindex(
            socket.gethostname(), socket.gethostbyname(socket.gethostname()),
            ipset(files[0]), ipset(files[1])
        )
        if len(files) > 2:
            open(files[2], "wt").write(json.dumps(cfg, indent=2))
            process_configs(files[2:])
        else:
            print(json.dumps(cfg, indent=2))
    elif "--iptables" in opts:
        cfg = fwcounter_mkindex(
            socket.gethostname(), socket.gethostbyname(socket.gethostname()),
            iptables_src(files[1]), iptables_dst(files[0])
        )
        if len(files) > 2:
            open(files[2], "wt").write(json.dumps(cfg, indent=2))
            process_configs(files[2:])
        else:
            print(json.dumps(cfg, indent=2))
    elif "--nft" in opts:
        cfg = fwcounter_mkindex(
            socket.gethostname(), socket.gethostbyname(socket.gethostname()),
            nftables_set(files[1]), nftables_set(files[0])
        )
        if len(files) > 2:
            open(files[2], "wt").write(json.dumps(cfg, indent=2))
            process_configs(files[2:])
        else:
            print(json.dumps(cfg, indent=2))
    elif "--netdev" in opts:
        cfg = proc_net_dev("both", files[0]).mkindex()
        print(json.dumps(cfg, indent=2))
    elif "--hwmon" in opts:
        cfg = sys_class_hwmon().mkindex()
        print(json.dumps(cfg, indent=2))
    elif "--files" in opts:
        cfg = files_mkindex(files)
        print(json.dumps(cfg, indent=2))
    elif "--cmd" in opts:
        cfg = cmd_mkindex(files)
        print(json.dumps(cfg, indent=2))
    elif "--test" in opts or "-t" in opts:
        print(SNMP(files[0]).getall(files[1:]))
    else:
        process_configs(files)
