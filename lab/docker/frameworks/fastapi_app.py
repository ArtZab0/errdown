from fastapi import FastAPI, HTTPException
app = FastAPI()
@app.get("/boom")
def boom(): raise RuntimeError("boom")
@app.get("/forbidden")
def forbidden(): raise HTTPException(403, "Not allowed")
@app.get("/items/{item_id}")
def item(item_id: int): return {"id": item_id}
