async function checkTime() {
  try {
    const res = await fetch('https://testnet.binancefuture.com/fapi/v1/time');
    const data = await res.json();
    console.log('Server time:', data.serverTime);
    console.log('Local time: ', Date.now());
    console.log('Diff:       ', data.serverTime - Date.now());
  } catch (err) {
    console.error(err);
  }
}
checkTime();
