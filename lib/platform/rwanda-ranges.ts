// Address ranges of Rwanda's internet providers and networks, for lib/platform/headers.ts. Pure, no imports.
//
// Why: the location lists hosts use place some Rwandan connections in another country. On 6 November 2026 a Liquid
// Telecom Rwanda home line (AS37006) showed as Kampala, Uganda, in Cloudflare's cf-ipcountry and on ipinfo.io, so
// bupulse.com/pricing showed East Africa prices in USD to a visitor in Kigali. An address in one of these ranges is
// counted as Rwanda whatever the host says.
//
// Source (RIPEstat, 6 November 2026): every address block AfriNIC registers to Rwanda (country-resource-list RW) plus
// every prefix announced by the networks registered in Rwanda (MTN Rwandacell, Airtel Rwanda, Liquid Telecommunication
// Rwanda, KT Rwanda Network, Broadband Systems Corporation, Axiom Networks, RINEX, the University and Ministry of
// Education, banks and public bodies), merged. Refresh with scripts/rwanda-ranges.py.
export const RWANDA_RANGES: readonly string[] = [
  "41.60.151.0/24", "41.74.160.0/20", "41.77.6.0/24", "41.79.63.0/24", "41.138.80.0/21", "41.173.28.0/22",
  "41.173.32.0/22", "41.173.168.0/22", "41.173.182.0/23", "41.173.248.0/21", "41.186.0.0/16", "41.197.0.0/16",
  "41.215.248.0/22", "41.216.96.0/20", "41.216.112.0/21", "41.216.120.0/22", "41.216.126.0/23", "41.222.244.0/22",
  "41.223.224.0/22", "41.242.140.0/22", "45.215.227.0/24", "45.215.248.0/24", "45.215.250.0/24", "66.178.97.0/24",
  "102.0.122.0/23", "102.22.128.0/18", "102.130.32.0/21", "102.202.79.0/24", "102.202.96.0/22", "102.202.188.0/24",
  "102.202.208.0/22", "102.207.48.0/24", "102.207.141.0/24", "102.209.168.0/22", "102.211.72.0/22",
  "102.213.212.0/23", "102.214.220.0/23", "102.215.8.0/22", "102.218.176.0/22", "102.219.173.0/24", "105.178.0.0/17",
  "105.179.0.0/19", "105.234.148.0/24", "105.234.150.0/24", "105.234.154.0/23", "105.234.156.0/23",
  "105.234.172.0/24", "137.64.16.0/21", "137.196.4.0/24", "154.68.64.0/18", "156.38.8.0/21", "196.12.128.0/19",
  "196.44.240.0/20", "196.49.7.0/24", "196.216.80.0/23", "196.223.12.0/24", "196.223.240.0/21", "197.148.140.0/24",
  "197.157.128.0/18", "197.157.212.0/22", "197.158.255.0/24", "197.214.37.0/24", "197.214.39.0/24",
  "197.214.57.0/24", "197.214.245.0/24", "197.214.253.0/24", "197.234.244.0/22", "197.243.0.0/17",
  "2001:43f8:150::/47", "2001:43f8:d80::/48", "2001:43f8:11e0::/48", "2001:43fc:7000::/48", "2001:43fc:9000::/48",
  "2001:43fd:8000::/48", "2001:43fe:800::/48", "2001:43ff:8800::/48", "2001:43ff:a800::/48", "2001:43ff:c000::/48",
  "2c0e:7c00::/24", "2c0f:580::/32", "2c0f:9a0::/32", "2c0f:3880::/32", "2c0f:56c0::/32", "2c0f:6100::/32",
  "2c0f:6700::/32", "2c0f:eb68::/32", "2c0f:f628::/32", "2c0f:f860::/32", "2c0f:fe30::/32", "2c0f:fe60::/32",
];
