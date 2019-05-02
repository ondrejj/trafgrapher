#!/usr/bin/python3

'''
Download statistics from DELL Compellent array.

Licensed under the MIT license.

Usage: compellent.py https://storage_ip username /path/password_file \\
         serial objtype
ObjTypes: Volume, Disk, ServerHba, Controller, ControllerPort
'''

import sys, urllib.request, ssl, os, uuid, socket, base64

soap_ping_template = b'''\
<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:Ping xmlns:ns2="http://WebServer.WebServices.compellent.com/"/>
  </S:Body>
</S:Envelope>
'''

soap_apicommand_template = b'''\
<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:ApiCommand xmlns:ns2="http://WebServer.WebServices.compellent.com/">
      <arg0>%s</arg0>
    </ns2:ApiCommand>
  </S:Body>
</S:Envelope>
'''

login_template = b'''\
<compapi>
  <ApiMethod>
    <CommandType>Method</CommandType>
    <Object>ApiConnection</Object>
    <Command>PrivateLogin</Command>
    <Async>false</Async>
    <ObjectEncodeType>Csv</ObjectEncodeType>
    <Attributes>
      <TrustedKey>{%s}</TrustedKey>
      <Locale>en_US</Locale>
      <UserName>%s</UserName>
      <ApplicationVersion>16.3.20.22</ApplicationVersion>
      <UserPassword>%s</UserPassword>
      <Application>Client</Application>
      <HostName>%s</HostName>
      <Source>Java</Source>
    </Attributes>
  </ApiMethod>
</compapi>
'''

volume_template = soap_apicommand_template % b'''\
<compapi>
  <ApiConnection>
    <SessionKey>%s</SessionKey>
    <UserId></UserId>
    <Source>Java</Source>
    <CommandLine>False</CommandLine>
    <Private>True</Private>
    <ApplicationVersion>16.3.20.22</ApplicationVersion>
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

DEBUG = False

class compellent_class():
  def __init__(self, url, login, password):
      # login
      self.auth = b"Basic " + (
        base64.b64encode((login+":"+password).encode()
        ).strip())
      req = urllib.request.Request(url, soap_ping_template, headers=dict(
        Authorization = self.auth,
        SOAPAction = b'"http://WebServer.WebServices.compellent.com/CompellentAPIServicesIntf/PingRequest"'
      ))
      query = urllib.request.urlopen(req, context=ctx)
      self.cookie = query.headers['set-cookie']
      self.session = self.cookie.split('|')[-1].split(';')[0]
      if DEBUG:
        print(query.headers)
        print(req.data)
        print(query.read())
      self.login2(login, password)

  def login2(self, login, password):
      #tk = uuid.uuid4()
      tk = b"472ACB4D-D355-49eb-A26E-008F4DD119B4"
      apicmd = login_template % (tk, login.encode(), password.encode(),
                 socket.gethostname().encode())
      req = urllib.request.Request(url, soap_apicommand_template % apicmd,
        headers = {
          "Cookie": self.cookie,
          "SOAPAction": b'"http://WebServer.WebServices.compellent.com/CompellentAPIServicesIntf/ApiCommandRequest"'
        }
      )
      reply = urllib.request.urlopen(req, context=ctx).read()
      if DEBUG:
        print("HEADERS:\n", str(req.headers))
        print("REQ:\n", req.data)
        print("REPLY:\n", reply)

  def get(self, template, *data):
      # get IO data
      req = urllib.request.Request(url, template % tuple([self.session.encode()]+list(data)),
        headers = {
          "Cookie": self.cookie,
          "SOAPAction": '"http://WebServer.WebServices.compellent.com/CompellentAPIServicesIntf/ApiCommandRequest"'
        }
      )
      reply = urllib.request.urlopen(req, context=ctx).read()
      if DEBUG:
        print("HEADERS:\n", str(req.headers))
        print("REQ:\n", req.data)
        print("REPLY:\n", reply)
      return reply

if __name__ == "__main__":
  DEBUG = "--debug" in sys.argv
  if DEBUG:
    sys.argv.remove("--debug")
  if len(sys.argv)<5:
    print(__doc__)
  else:
    url, login, password, serial = sys.argv[1:5]
    url = url.rstrip("/")+"/api/CompellentAPIServices"
    if os.path.isfile(password):
      password = open(password).read().strip()

    compellent = compellent_class(url, login, password)
    for objtype in sys.argv[5:]:
      if ":" in objtype:
        objtype, filename = objtype.encode().split(b":", 1)
        open(filename, "wb").write(
          compellent.get(volume_template, serial.encode(), objtype)
        )
      else:
        print(compellent.get(volume_template, serial.encode(), objtype))
