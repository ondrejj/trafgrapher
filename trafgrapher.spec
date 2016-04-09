Name:           trafgrapher
Version:        2.1
Release:        1%{?dist}
Summary:        Collect and display network/disk/storage transfers.

License:        MIT
URL:            http://www.salstar.sk/trafgrapher/
Source0:        http://www.salstar.sk/pub/trafgrapher/trafgrapher-%{version}.tgz
Source1:	http://www.flotcharts.org/downloads/flot-0.8.3.tar.gz
BuildArch:      noarch

#Requires:       nodejs-flot

%description
TrafGrapher is an javascript script to collect and display data.
It can read MRTG log files, or can collect it's own data.
Also useable to display SAN storage performance or Nagios performance data.


%prep
%setup -q


%build
mkdir web
ln -s network.html index.html
mv *.css *.html *.js web/
tar xvzf %{SOURCE1} -C web --exclude '._*'
rm -rf web/flot/examples


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
%config(noreplace) %verify(not md5 size mtime) %{_sysconfdir}/httpd/conf.d/trafgrapher.conf
%{_bindir}/*
%{_datadir}/%{name}


%changelog
* Fri Apr  8 2016 Ján ONDREJ (SAL) <ondrejj(at)salstar.sk>
- initial release
