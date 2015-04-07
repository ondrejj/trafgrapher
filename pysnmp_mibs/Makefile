all:	IF-MIB.py IANAifType-MIB.py

%.py:	/usr/share/snmp/mibs/%.txt
	build-pysnmp-mib -o $@ $<
