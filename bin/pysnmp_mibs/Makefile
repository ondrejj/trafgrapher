all:	IF-MIB.py IANAifType-MIB.py SNMPv2-SMI.py

%.py:	/usr/share/snmp/mibs/%.txt
	build-pysnmp-mib -o $@ $<
