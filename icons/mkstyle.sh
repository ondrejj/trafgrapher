#!/bin/bash

optimize() {
  tr -d '\n' < "$1" | sed -e 's/ \+/ /g' -e 's/> \+</></g' \
    -e 's/#/%23/g' -e 's/</%3C/g' -e 's/>/%3E/g' -e "s/\"/'/g"
}

cd `dirname $0`
for svg in *.svg; do
  name="${svg%.svg}"
  echo "div.trafgrapher button.b_$name {"
  echo "  background-image: url(\"data:image/svg+xml,`optimize $svg`\");"
  echo "}"
done
