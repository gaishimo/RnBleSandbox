import React, { Component } from 'react';
import BleManager from 'react-native-ble-manager'
import { Buffer } from 'buffer'
import {
  Platform,
  StyleSheet,
  Text,
  View,
  ScrollView,
  Button,
  NativeModules,
  NativeEventEmitter,
  Alert,
} from 'react-native';


const SERVICES = {
  BLOOD_PRESSURE: '1810'
}

const CHARACTERISTICS = {
  BLOOD_PRESSURE_MEASUREMENT: '2A35',
  BLOOD_PRESSURE_FEATURE: '2A49',
  DATE_TIME: '2A08',
}

const bleManagerEmitter = new NativeEventEmitter(NativeModules.BleManager)

const timeByteData = (d = new Date()) => {
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const seconds = d.getSeconds()
  return [
    // yearの下位・上位の順番に注意
    year & 0xFF,  // 下位8bit, yearが2017の場合: 225(0xE1)
    year >> 8,  // 上位8bit yearが2017の場合: 7(0x07)
    month,
    day,
    hours,
    minutes,
    seconds,
  ]
}

const convertTimeValuesToDate = (timeValues: Array<Number>) => {
  const [year1, year2, month, day, hours, minutes, seconds] = timeValues
  const year = (year2 << 8) + year1
  return new Date(year, month - 1, day, hours, minutes, seconds)
}

const convertToTimeString = (timeValues) => {
  const [year1, year2, month, date, hours, minutes, seconds] = timeValues
  const year = (year2 << 8) + year1
  return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`
}

const parseMeasurementValues = (valueArray) => {
  const systolicPressure = valueArray[1]
  const diastolicPressure = valueArray[3]
  const meanArterialPressure = valueArray[5]
  const timestampArray = valueArray.slice(7, 14)
  const timestamp = convertTimeValuesToDate(timestampArray)
  return {
    systolicPressure,
    diastolicPressure,
    meanArterialPressure,
    timestamp,
  }
}

export default class App extends Component<{}> {

  state = {
    action: null, // 1 2
    peripheralId: null,
    peripheralName: null,
    timestamp: null,
    measurements: [],
    waitingForAdvertising: false,
  }

  peripheral: ?Object
  afterMeasurementScanIntervalId: ?Number

  componentDidMount() {
    (async () => {
      await BleManager.start()
      console.log('Ble module initialized')
    })()

    bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', this.onDiscoverPeripheral)
    bleManagerEmitter.addListener('BleManagerDidUpdateValueForCharacteristic', this.onReceiveCharacteristic)
  }

  componentWillUnMount() {
    this.clearInterval()
  }

  /*
   * 事前ペアリング
   */
  onPressPairingStart = async () => {
    this.setState({ action: 1 })
    setTimeout(() => {
      if (this.peripheral == null) {
        Alert.alert('', '機器が見つかりませんでした')
      }
    }, 1000 * 5)
    await this.startScanning()
    return
  }

  onPressNotificationStart = async () => {
    this.setState({ action: 2, waitingForAdvertising: true })
    // 測定中は機器がAdvertisingしないため、測定完了してAdvertisingが開始されるまで定期的にscanを試みる
    this.afterMeasurementScanIntervalId = setInterval(async () => {
      await this.startScanning()
    }, 1000 * 5)
    await this.startScanning()
    return
  }

  onPressClear = () => {
    this.setState({
      peripheralId: null,
      peripheralName: null,
      timestamp: null,
      measurements: [],
      waitingForAdvertising: false,
    })
    this.peripheral = null
    this.clearInterval()
  }

  clearInterval() {
    if (this.afterMeasurementScanIntervalId) {
      clearInterval(this.afterMeasurementScanIntervalId)
      this.afterMeasurementScanIntervalId = null
    }
  }

  async startScanning() {
    await BleManager.scan([SERVICES.BLOOD_PRESSURE], 5, true)
    console.log('scan started')
  }

  async startNotification() {
    await BleManager.startNotification(
      this.peripheral.id,
      SERVICES.BLOOD_PRESSURE,
      CHARACTERISTICS.BLOOD_PRESSURE_MEASUREMENT,
    )
    console.log('startNotification')
  }

  onDiscoverPeripheral = async (peripheral) => {
    if (this.peripheral == null) {
      console.log('peripheral discovered')
      this.peripheral = peripheral
      // 測定後のscan用のintervalを解除
      this.clearInterval()
      this.setState({
        peripheralId: peripheral.id,
        peripheralName: peripheral.name,
        waitingForAdvertising: false,
      })
      await BleManager.stopScan()
      await this.connectWithTimeSetting()
    }
  }

  connectWithTimeSetting = async () => {
    try {
      await BleManager.connect(this.peripheral.id)
      await BleManager.retrieveServices(this.peripheral.id)

      // timestampの書き込み
      const service = SERVICES.BLOOD_PRESSURE
      const characteristic = CHARACTERISTICS.DATE_TIME
      const data = timeByteData()
      console.log('timeByteData:', data)
      await BleManager.write(this.peripheral.id, service, characteristic, data)

      // 書き込んだものをreadしてみる
      const timestampValues = await BleManager.read(this.peripheral.id, service, characteristic)
      console.log('timestampValues:', timestampValues)
      this.setState({ timestamp: convertTimeValuesToDate(timestampValues) })

      if (this.state.action === 1) {
        Alert.alert('', '血圧計とペアリング済')
      }

      if (this.state.action === 2) {
        // 受信待ち
        await this.startNotification()
      }
    } catch (e) {
      console.log(e)
      return
    }
  }

  /*
   * 測定データを受け取った時
   */
  onReceiveCharacteristic = async (args) => {
    console.log('onReceiveCharacteristic args:', args)
    const measurementValues = args.value
    console.log('measurementValues:', measurementValues)
    const measurement = parseMeasurementValues(measurementValues)
    console.log('measurement:', measurement)
    this.setState({
      measurements: [...this.state.measurements, measurement]
    })

  }

  render() {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>
          React Native BLE Sandbox
        </Text>
        <View style={styles.actions}>
          <View style={styles.buttonWrapper}>
            <Button
              title="ペアリング実施"
              color="#4180DE"
              onPress={this.onPressPairingStart}
            />
          </View>
          <View style={styles.buttonWrapper}>
            <Button
              title="測定データ受信開始"
              color="#4180DE"
              onPress={this.onPressNotificationStart}
              disabled={this.state.waitingForAdvertising}
            />
          </View>
          <View style={styles.buttonWrapper}>
            <Button
              title="クリア"
              color="#ACDADE"
              onPress={this.onPressClear}
            />
          </View>
        </View>
        <View style={styles.info}>
          {this.state.peripheralId &&
            <View>
              <Text>Peripheral ID: {this.state.peripheralId}</Text>
              <Text>Peripheral Name: {this.state.peripheralName}</Text>
              <Text>Timestamp: {this.state.timestamp && this.state.timestamp.toString()}</Text>
            </View>
          }
        </View>
        <View style={styles.results}>
          {this.state.waitingForAdvertising &&
            <Text>受信待機中...</Text>
          }
          {this.state.measurements.length > 0 &&
              this.state.measurements.map(measurement => (
                <View key={measurement.timestamp.toString()}>
                  <Text>日時: {measurement.timestamp.toString()}</Text>
                  <Text>最高血圧(収縮期圧): {measurement.systolicPressure}</Text>
                  <Text>最低血圧(拡張期血圧): {measurement.diastolicPressure}</Text>
                  <Text>平均血圧:{measurement.meanArterialPressure}</Text>
                </View>
              ))
          }
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
    backgroundColor: '#F5FCFF',
    padding: 20,
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
    marginTop: 30,
  },
  actions: {
    marginTop: 30,
  },
  buttonWrapper: {
    marginBottom: 20,
  },
  info: {
    marginTop: 20,
    flexDirection: 'column',
  },
  results: {
    marginTop: 20,
    alignItems: 'center',
  },
});
