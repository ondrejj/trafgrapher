#!/usr/bin/python

'''
Download statistics from DELL Compellent array.

Licensed under the MIT license.

Usage: compellent.py https://storage_ip username /path/password_file \\
         serial objtype
ObjTypes: Volume, Disk, ServerHba, Controller, ControllerPort
'''

import sys, urllib2, ssl, os

soap_ping_template = '''\
<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:Ping xmlns:ns2="http://WebServer.WebServices.compellent.com/"/>
  </S:Body>
</S:Envelope>
'''

soap_apicommand_template = '''\
<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:ApiCommand xmlns:ns2="http://WebServer.WebServices.compellent.com/">
      <arg0>%s</arg0>
    </ns2:ApiCommand>
  </S:Body>
</S:Envelope>
'''

volume_template = soap_apicommand_template % '''\
<compapi>
  <ApiConnection>
    <SessionKey>%s</SessionKey>
    <UserId></UserId>
    <Source>Java</Source>
    <CommandLine>False</CommandLine>
    <Private>True</Private>
    <ApplicationVersion>15.2.1.350</ApplicationVersion>
    <Application>Client</Application>
    <Locale>en_US</Locale>
  </ApiConnection>
  <ApiMethod>
    <CommandType>Method</CommandType>
    <Object>ScRawIoUsageValues</Object>
    <Command>GetRawValues</Command>
    <Async>false</Async>
    <ObjectEncodeType>Csv</ObjectEncodeType>
    <Attributes>
      <ScSerialNumber>%s</ScSerialNumber>
      <ScObjectType>%s</ScObjectType>
    </Attributes>
  </ApiMethod>
</compapi>
'''

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

class compellent_class():
  def __init__(self, url, login, password):
      # login
      self.auth = "Basic " + ((login+":"+password).encode('base64').strip())
      req = urllib2.Request(url, soap_ping_template, headers=dict(
        Authorization = self.auth,
        SOAPAction = '"http://WebServer.WebServices.compellent.com/CompellentAPIServicesIntf/PingRequest"'
      ))
      query = urllib2.urlopen(req, context=ctx)
      self.cookie = query.headers['set-cookie']
      self.session = self.cookie.split('|')[-1]

  def get(self, template, *data):
      # get IO data
      req = urllib2.Request(url, template % tuple([self.session]+list(data)),
        headers = dict(
          Authorization = self.auth,
          Cookie = self.cookie,
          SOAPAction = '"http://WebServer.WebServices.compellent.com/CompellentAPIServicesIntf/ApiCommandRequest"'
        )
      )
      return urllib2.urlopen(req, context=ctx).read()

if __name__ == "__main__":
  if len(sys.argv)<5:
    print(__doc__)
  else:
    url, login, password, serial = sys.argv[1:5]
    url = url.rstrip("/")+":3033/api/CompellentAPIServices"
    if os.path.isfile(password):
      password = open(password).read().strip()

    compellent = compellent_class(url, login, password)
    for objtype in sys.argv[5:]:
      if ":" in objtype:
        objtype, filename = objtype.split(":", 1)
        open(filename, "wt").write(
          compellent.get(volume_template, serial, objtype)
        )
      else:
        print(compellent.get(volume_template, serial, objtype))
