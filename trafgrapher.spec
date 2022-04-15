# use python3 for Fedora
%if 0%{?fedora} || 0%{?rhel} > 7
%global PYTHON %{python3}
%global PYTHON_SITELIB %{python3_sitelib}
%else
%global PYTHON %{_bindir}/python2
%global PYTHON_SITELIB %{python2_sitelib}
%endif

Name:           trafgrapher
Version:        3.3.0
Release:        0.beta6%{?dist}
Summary:        Collect and display network/disk/storage transfers.

License:        MIT
URL:            https://www.salstar.sk/trafgrapher/
Source0:        https://www.salstar.sk/pub/trafgrapher/trafgrapher-%{version}.tgz
BuildArch:      noarch

%if 0%{?fedora} || 0%{?rhel} > 7
BuildRequires:  python3-devel
%else
BuildRequires:  python2-devel
%endif

# use distribution jquery
BuildRequires:  js-jquery
Requires:       js-jquery

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
rm -f bin/tgc.py # remove client symlink
if [ -d /usr/share/javascript/jquery/latest ]; then
  rm web/flot/jquery.js web/flot/jquery.min.js web/flot/jquery.min.map
  ln -s ../../../javascript/jquery/latest/jquery.js web/flot/
  ln -s ../../../javascript/jquery/latest/jquery.min.js web/flot/
  ln -s ../../../javascript/jquery/latest/jquery.min.map web/flot/
fi
# update python version
sed -i 's|#!/usr/bin/python[23]|#!%{PYTHON}|' bin/*.py


%install
mkdir -p $RPM_BUILD_ROOT%{_bindir} $RPM_BUILD_ROOT%{_datadir}/%{name} \
  $RPM_BUILD_ROOT%{PYTHON_SITELIB}
mv bin/trafgrapher.py $RPM_BUILD_ROOT%{PYTHON_SITELIB}/
ln -s %{PYTHON_SITELIB}/%{name}.py $RPM_BUILD_ROOT%{_bindir}/tgc
cp -ar bin/* $RPM_BUILD_ROOT%{_datadir}/%{name}
cp -ar web $RPM_BUILD_ROOT%{_datadir}/%{name}
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
%if 0%{?fedora} || 0%{?rhel} > 7
%{python3_sitelib}/%{name}.py
%pycached %{python3_sitelib}/%{name}.py
%else
%{python2_sitelib}/%{name}.py*
%endif
%{_bindir}/*
%{_datadir}/%{name}


%changelog
* Fri Apr  8 2016 Ján ONDREJ (SAL) <ondrejj(at)salstar.sk>
- initial release
