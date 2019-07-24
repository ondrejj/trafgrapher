# use python3 for Fedora
%if 0%{?fedora} || 0%{?rhel} > 7
%define PYTHON %{_bindir}/python3
%else
%define PYTHON %{_bindir}/python2
%endif

Name:           trafgrapher
Version:        3.1.0
Release:        0.beta5%{?dist}
Summary:        Collect and display network/disk/storage transfers.

License:        MIT
URL:            http://www.salstar.sk/trafgrapher/
Source0:        http://www.salstar.sk/pub/trafgrapher/trafgrapher-%{version}.tgz
#Source1:	https://github.com/flot/flot/archive/v3.1.1.tar.gz
BuildArch:      noarch

# use prebuilt jquery for EPEL-6
%if 0%{?rhel} != 6
BuildRequires:  js-jquery
Requires:       js-jquery
%endif

%description
TrafGrapher is an javascript script to collect and display data.
It can read MRTG log files, or can collect it's own data.
Also useable to display SAN storage performance or Nagios performance data.


%prep
%setup -q


%build
mkdir web
ln -s network.html index.html
mv *.css *.html *.js flot web/
#tar xvzf %{SOURCE1} -C web --exclude '._*'
#mv web/flot-*/source web/flot
#rm -rf web/flot-*
if [ -d /usr/share/javascript/jquery/latest ]; then
  rm web/flot/jquery.js web/flot/jquery.min.js web/flot/jquery.min.map
  ln -s /usr/share/javascript/jquery/latest/* web/flot/
fi
# update python version
sed -i 's|#!/usr/bin/python[23]|#!%{PYTHON}|' bin/*.py


%install
rm -rf $RPM_BUILD_ROOT
mkdir -p $RPM_BUILD_ROOT%{_bindir} $RPM_BUILD_ROOT%{_datadir}/%{name}
cp -ar bin/* $RPM_BUILD_ROOT%{_datadir}/%{name}
cp -ar web $RPM_BUILD_ROOT%{_datadir}/%{name}
ln -s ../share/%{name}/tgc.py $RPM_BUILD_ROOT%{_bindir}/tgc
ln -s ../share/%{name}/compellent.py $RPM_BUILD_ROOT%{_bindir}/tg_compellent
ln -s ../share/%{name}/process_perfdata.py $RPM_BUILD_ROOT%{_bindir}/tg_process_perfdata
mkdir -p $RPM_BUILD_ROOT%{_sysconfdir}/httpd/conf.d
cat > $RPM_BUILD_ROOT%{_sysconfdir}/httpd/conf.d/trafgrapher.conf << EOF
<Directory /usr/share/trafgrapher/web>
    Options SymLinksifOwnerMatch
    <IfModule mod_authz_core.c>
        # Apache 2.4
        Require all granted
    </IfModule>
    <IfModule !mod_authz_core.c>
        # Apache 2.2
        AllowOverride None
        Order allow,deny
        Allow from all
    </IfModule>
</Directory>

Alias /trafgrapher %{_datadir}/%{name}/web
#Alias /trafgrapher/flot /usr/lib/node_modules/flot
EOF


%files
%defattr(-,root,root)
%doc README.md
%{!?_licensedir:%global license %%doc}
%license LICENSE.txt
%config(noreplace) %verify(not md5 size mtime) %{_sysconfdir}/httpd/conf.d/trafgrapher.conf
%{_bindir}/*
%{_datadir}/%{name}


%changelog
* Fri Apr  8 2016 Ján ONDREJ (SAL) <ondrejj(at)salstar.sk>
- initial release
