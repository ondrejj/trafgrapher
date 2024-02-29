#!/usr/bin/python3 -S

'''
Process nagios performance data for TrafGrapher

(c) 2016-2024 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>

Licensed under the MIT license.

Testing variables:
export NAGIOS_PERF_LOG_DIR=/tmp/perf
export NAGIOS_HOSTNAME=www
#export NAGIOS_SERVICEPERFDATA='rta=1.276000ms;100.000000;500.000000;0.000000 pl=0%;30;60;0'
export NAGIOS_SERVICEDESC=nrpe_eth0
export NAGIOS_SERVICEPERFDATA='collisions=0c;1;10;0;131072000 rx_bytes=408966251704c;117964800;124518400;0;131072000 tx_bytes=6116960562c;117964800;124518400;0;131072000 rx_packets=198208226c;;;0;131072000 tx_packets=76580546c;;;0;131072000 rx_errors=0c;1;10;0;131072000 tx_errors=0c;1;10;0;131072000 rx_dropped=0c;1;10;0;131072000 tx_dropped=0c;1;10;0;131072000'
export NAGIOS_TIMET=1457008744
./process_perfdata.py
'''

import sys
import re
import shlex
import os
import fcntl
import time
import base64

prefix = os.environ.get("NAGIOS_PERF_LOG_DIR", "/var/log/nagios/perf")


class grouper(dict):
    one_day = 24*3600
    compress_intervals = {
        one_day: 1,
        7*one_day: 300,  # 5m
        30*one_day: 1800,  # 30m
        62*one_day: 7200,  # 2h
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
            val = sum([x for x in values])/lv  # avg
            ret.append((key, val))
        return ret

    def load(self, deltas, start=None):
        if start is None:
            if deltas:
                start = max(deltas.keys())
            else:
                start = time.time()
        intervals = list(self.compress_intervals.items())
        limit = None
        for t in sorted(deltas, reverse=True):
            if limit is None or start-t >= limit:
                if intervals:
                    limit, interval_range = intervals.pop(0)
                else:
                    break
            st = int(t/interval_range)*interval_range
            self[st].append(deltas[t])


class Logfiles:
    re_num_unit = re.compile("^(-?[0-9.]+)([a-zA-Z/%]*)$")
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
        return '~'+base64.b64encode(
            fn.encode()
        ).decode().strip().replace("\n", "")

    def escape_old(self, fn):
        ret = ''
        for x in fn:
            if (x >= 'a' and x <= 'z') or (x >= 'A' and x <= 'Z') or (x >= '0' and x <= '9') \
               or x in ':_-.,':
                ret += x
                continue
            else:
                ret += "%%%02x" % ord(x)
        return ret

    def fmt(self, value):
        if type(value) == int:
            return "%d" % value
        elif type(value) == float:
            # return ("%.9f" % value).rstrip('0')
            return str(value)
        return value

    def update(self, utime, values):
        if not values[0]:
            return  # do not process empty values
        try:
            mtime = os.stat(self.filename).st_mtime
        except OSError:
            mtime = time.time()
        value, unit = self.re_num_unit.search(
            values[0].replace(",", ".")
        ).groups()
        # compress before write
        if mtime//grouper.one_day < time.time()//grouper.one_day:
            self.compress("\t".join([self.hsl, unit] + values[1:])+"\n")
        # write new data
        self.f = open(self.filename, "at")
        fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not self.header:
            self.f.write("\t".join([self.hsl, unit] + values[1:])+"\n")
        self.f.write("%d %s\n" % (utime, self.fmt(value)))
        self.f.close()

    def compress(self, header):
        # read current file
        in_f = open(self.filename, "rt")
        old_header = in_f.readline()
        max_time = time.time() + 3600*24  # anything beyond 1 day from now
        data = {}
        for row in in_f.readlines():
            rowa = row.strip("\0 \r\n").split()
            if len(rowa) < 2:
                # ignore incomplete rows
                print("Load error:", self.filename, row)
            else:
                t = int(rowa[0])
                if t > max_time:
                    print("Time from future ignored: %s: %d" %
                          (self.filename, t))
                else:
                    data[t] = float(rowa[1])
        in_f.close()
        # compress data
        grp = grouper()
        grp.load(data)
        ret = dict(grp.items(header.split("\t")[3] == "c"))
        # save new file
        self.f = open(self.filename+".tmp", "wt")
        fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.f.write(header)
        for key in sorted(ret.keys()):
            val = ret[key]
            if int(val) == val:
                val = int(val)
            self.f.write("%d %s\n" % (key, self.fmt(val)))
        self.f.close()
        # rename new file to old file
        os.rename(self.filename+".tmp", self.filename)


try:
    maketrans = str.maketrans  # py3
except AttributeError:
    import string
    maketrans = string.maketrans  # py2
swap_chars_trans = maketrans("/ ", " /")


def swap_chars(s):
    return s.lower().translate(swap_chars_trans)


def mkindex(subdirs=True):
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
    filelist.sort(key=swap_chars)
    open(os.path.join(prefix, "index.html"), "wt").write("\n".join(filelist))
    if subdirs:
        for host, files in sublists.items():
            open(os.path.join(prefix, host, "index.html"), "wt").write(
                "\n".join(sorted(files))
            )


if __name__ == "__main__":
    if "--make-index" in sys.argv or "-i" in sys.argv:
        if os.getuid() == 0:
            print("Dropping privileges to nagios user ...")
            import pwd, grp
            os.setgroups([])
            os.setgid(grp.getgrnam("nagios").gr_gid)
            os.setuid(pwd.getpwnam("nagios").pw_uid)
        mkindex()
    elif len(sys.argv) == 1:
        hostname = os.environ.get("NAGIOS_HOSTNAME")
        service_name = os.environ.get("NAGIOS_SERVICEDESC")
        service_perfdata = os.environ.get("NAGIOS_SERVICEPERFDATA")
        service_time = os.environ.get("NAGIOS_TIMET")
        #print >> sys.stderr, service_name, service_perfdata
        if service_name and service_perfdata:
            for data in service_perfdata.split(" "):
                label, values = data.split("=", 1)
                logfile = Logfiles(hostname, service_name, label)
                logfile.update(int(service_time), values.split(";"))
    else:
        # bulk mode
        for line in open(sys.argv[1]).readlines():
            kw = dict([x.split("::", 1) for x in line.strip().split("\t")])
            hostname = kw["HOSTNAME"]
            service_name = kw["SERVICEDESC"]
            service_perfdata = kw["SERVICEPERFDATA"]
            service_time = kw["TIMET"]
            #print >> sys.stderr, service_name, service_perfdata
            if service_name and service_perfdata:
                for data in shlex.split(service_perfdata):
                    try:
                        label, values = data.rsplit("=", 1)
                        logfile = Logfiles(hostname, service_name, label)
                        logfile.update(int(service_time), values.split(";"))
                    except Exception as err:
                        print("Error processing data [%s]: %s" % (data, err))
        os.unlink(sys.argv[1])
