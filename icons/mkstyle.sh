#!/bin/bash

ARGS="--create-groups=true \
  --enable-id-stripping=true --enable-comment-stripping=true \
  --remove-metadata=true --strip-xml-prolog=true --enable-viewboxing=true \
  --line-breaks=false"

scour() {
  python /usr/share/inkscape/extensions/scour.inkscape.py "$@" \
    | sed -e 's/#000/black/g' -e 's/#fff/white/g' \
          -e 's/#/%23/g' -e 's/</%3C/g' -e 's/>/%3E/g' -e "s/\"/'/g" \
    #| base64 -w 0
}

cd `dirname $0`
for svg in *.svg; do
  name="${svg%.svg}"
  echo "div.trafgrapher button.b_$name {"
  echo "  background-image: url(\"data:image/svg+xml,`scour $ARGS $svg`\");"
  echo "}"
done
