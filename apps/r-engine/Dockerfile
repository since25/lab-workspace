FROM rocker/r-ver:4.4.2
WORKDIR /srv/app
RUN R -e "install.packages(c('plumber','jsonlite'), repos='https://cloud.r-project.org')"
COPY . .
EXPOSE 8000
CMD ["R", "-e", "pr <- plumber::plumb('plumber.R'); pr$run(host='0.0.0.0', port=8000)"]
