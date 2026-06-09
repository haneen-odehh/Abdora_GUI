from tcia_utils import nbia

# get 5 series from a real working collection
series = nbia.getSeries(collection="NSCLC-Radiomics")
print(f"Found {len(series)} series")

# download just 5
nbia.downloadSeries(series, number=5, path="my_scans")