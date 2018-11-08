const CrosschainBase = require('../base');
const btcUtil = require('./utils');
const web3Util = require('../lib/web3');
const crypto = require('../lib/crypto');
const types = require('../lib/types');
const hex = require('../lib/hex');

const {
  validateSendOpts,
  validateRedeemOpts,
  validateRevokeOpts,
} = require('./validate');

class BTC_Inbound extends CrosschainBase {

  constructor(config) {
    super(config);
  }

  // first 1/2 of crosschain transaction
  // assumes that you have already created a new HTLC address and have sent
  // bitcoin to it
  lock(opts) {

    // validate inputs
    // opts = validateSendOpts(opts);

    return Promise.resolve([]).then(() => {

      // notify status
      this.emit('info', { status: 'starting', redeemKey: opts.redeemKey });

      return this.sendLockNoticeTx(opts);

    }).then(receipt => {

      // notify status
      this.emit('info', { status: 'locking', receipt });

      return this.listenLockTx(opts, receipt.blockNumber);

    }).then(receipt => {

      // notify complete
      this.emit('complete', { status: 'locked', receipt });

    }).catch(err => {

      // notify error
      this.emit('error', err)

    });
  }

  // second 1/2 of crosschain transaction
  // requires redeemKey to be passed in opts
  redeem(opts) {

    // validate inputs
    opts = validateRedeemOpts(opts);

    return Promise.resolve([]).then(() => {

      // notify status
      this.emit('info', { status: 'starting', redeemKey: opts.redeemKey });

      return this.sendRedeemTx(opts);

    }).then(receipt => {

      // notify complete
      this.emit('complete', { status: 'confirmed', receipt });

    }).catch(err => {

      // notify error
      this.emit('error', err)

    });
  }

  buildHashTimeLockContract(xHash, lockTimestamp, destH160Addr, revokerH160Addr) {
    return btcUtil.buildHashTimeLockContract(
      this.config.network,
      xHash,
      lockTimestamp,
      destH160Addr,
      revokerH160Addr
    );
  }

  buildRevokeTx(opts) {
    return btcUtil.buildRevokeTx(
      this.config.network,
      opts.redeemScript,
      opts.signedRedeemScript,
      opts.publicKey,
      opts.redeemKey.x,
      opts.txid,
      opts.value,
      opts.lockTimestamp,
    );
  }

  buildRevokeTxFromWif(opts) {
    return btcUtil.buildRevokeTxFromWif(
      this.config.network,
      opts.redeemScript,
      opts.wif,
      opts.redeemKey.x,
      opts.txid,
      opts.value,
      opts.lockTimestamp,
    );
  }

  // send lock transaction on ethereum
  sendLockNoticeTx(opts) {
    const sendOpts = this.buildLockNoticTx(opts);
    return web3Util(this.web3wan).sendTransaction(sendOpts);
  }

  buildLockNoticTx({ to, from, value, storeman, redeemKey, txid, lockTimestamp }) {
    const lockNoticeData = this.buildLockNoticeData({
      from,
      storeman,
      redeemKey,
      txid,
      lockTimestamp,
    });

    return {
      from: to,
      to: this.config.wanHtlcAddrBtc,
      gas: 4710000,
      gasPrice: 180e9,
      data: lockNoticeData,
    };
  }

  // listen for storeman tx on wanchain
  listenLockTx(opts, blockNumber) {
    const lockScanOpts = this.buildLockScanOpts(opts, blockNumber);
    return web3Util(this.web3wan).watchLogs(lockScanOpts);
  }

  buildLockScanOpts({ redeemKey }, blockNumber) {
    return {
      blockNumber,
      address: this.config.wanHtlcAddrBtc,
      topics: [
        '0x' + this.config.signatures.HTLCWBTC.BTC2WBTCLock,
        null,
        null,
        '0x' + hex.stripPrefix(redeemKey.xHash),
      ],
    };
  }

  // send refund transaction on wanchain
  sendRedeemTx(opts) {
    const sendOpts = this.buildRedeemTx(opts);
    return web3Util(this.web3wan).sendTransaction(sendOpts);
  }

  buildRedeemTx({ to, redeemKey }) {
    const redeemData = this.buildRedeemData({ redeemKey });

    return {
      from: to,
      to: this.config.wanHtlcAddrBtc,
      gas: 4700000,
      gasPrice: 180e9,
      data: redeemData,
    };
  }

  buildLockNoticeData({ storeman, from, redeemKey, txid, lockTimestamp }) {
    const sig = this.config.signatures.HTLCWBTC.btc2wbtcLockNotice;
    const fromHash160 = crypto.addressToHash160(from, 'pubkeyhash', this.config.network);

    return '0x' + sig.substr(0, 8)
      + types.hex2Bytes32(storeman.wan)
      + types.hex2Bytes32(fromHash160)
      + hex.stripPrefix(redeemKey.xHash)
      + hex.stripPrefix(txid)
      + types.num2Bytes32(lockTimestamp);
  }

  buildRedeemData({ redeemKey }) {
    const sig = this.config.signatures.HTLCWBTC.btc2wbtcRedeem;
    return '0x' + sig.substr(0, 8) + hex.stripPrefix(redeemKey.x);
  }
}

module.exports = BTC_Inbound;
