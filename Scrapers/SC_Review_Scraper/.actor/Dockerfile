FROM apify/actor-python:3.12

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# channel="chrome" in scrape_sc_reviews.py needs the real Chrome-for-Testing
# build, not just default Chromium.
RUN playwright install --with-deps chrome

# cloudflared — for the OTP relay quick tunnel (no account/login needed).
RUN curl -L --output /tmp/cloudflared.deb \
        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i /tmp/cloudflared.deb \
    && rm /tmp/cloudflared.deb

COPY . ./

CMD ["python3", "main.py"]
