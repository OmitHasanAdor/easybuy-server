import app from "./app.ts";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`EasyBuy server running on port ${PORT}`);
});