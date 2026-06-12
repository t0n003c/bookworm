import http.client
c=http.client.HTTPConnection("localhost",8000,timeout=5)
c.request("GET","/health")
r=c.getresponse()
print("Health:",r.status)
c.close()
