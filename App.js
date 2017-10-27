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
  Picker,
} from 'react-native';

const DEVICES = {
  UA651BLE: 'UA651BLE',
  HEM9200T: 'HEM9200T',
}

const DEVICE_UA651BLE = 'UA651BLE'
const DEVICE_HEM9200T = 'HEM9200T'

const SERVICE_BLOOD_PRESSURE = '1810'  // common
const SERVICE_CURRENT_TIME = '1805'  // Omron
const CHARACTERISTIC_BLOOD_PRESSURE_MEASUREMENT = '2a35' // common
const CHARACTERISTIC_CURRENT_TIME = '2a2b' // Omron
const CHARACTERISTIC_DATE_TIME = '2a08'   // A&D

const bleManagerEmitter = new NativeEventEmitter(NativeModules.BleManager)

const standardCharacteristicUuid = (uuid) => (`0000${uuid}-0000-1000-8000-00805f9b34fb`)

const timeByteDataForAAndD = (d = new Date()) => {
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const seconds = d.getSeconds()

  const yearData = new Uint8Array(new Uint16Array([year]).buffer) // 16bit -> 8bit array
  const otherData = new Uint8Array([month, day, hours, minutes, seconds])
  return [...Array.from(yearData), ...Array.from(otherData)]
}

const timeByteDataForOmron = (d = new Date()) => {
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const seconds = d.getSeconds()
  const dayOfWeek = (d.getDay() + 6) % 7 + 1  // 月曜日から1, 2, 3, 4, 5, 6, 7
  const yearData = new Uint8Array(new Uint16Array([year]).buffer) // 16bit -> 8bit array
  const otherData = new Uint8Array([month, day, hours, minutes, seconds, dayOfWeek, 0, 0b10000000])
  return [...Array.from(yearData), ...Array.from(otherData)]
}

const convertTimeValuesToDateForAAndD = (timeValues: Array<Number>) => {
  const [year1, year2, month, day, hours, minutes, seconds] = timeValues
  const year = new Uint16Array(new Uint8Array([year1, year2]).buffer)[0]  // 8bit -> 16bit
  return new Date(year, month - 1, day, hours, minutes, seconds)
}

const convertTimeValuesToDateForOmron = (timeValues: Array<Number>) => {
  const [year1, year2, month, day, hours, minutes, seconds] = timeValues.slice(0, 7)
  const year = new Uint16Array(new Uint8Array([year1, year2]).buffer)[0]  // 8bit -> 16bit
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
  const timestamp = convertTimeValuesToDateForAAndD(timestampArray)
  const pulseRate = valueArray[14]
  return {
    systolicPressure,
    diastolicPressure,
    meanArterialPressure,
    pulseRate,
    timestamp,
  }
}

export default class App extends Component<{}> {

  state = {
    device: DEVICES.HEM9200T,
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

  get timeSettingService() {
    if (this.state.device === DEVICES.UA651BLE) {
      return SERVICE_BLOOD_PRESSURE
    }
    return SERVICE_CURRENT_TIME // omron
  }

  get timeSettingCharacteristic() {
    if (this.state.device === DEVICES.UA651BLE) {
      return CHARACTERISTIC_DATE_TIME
    }
    return CHARACTERISTIC_CURRENT_TIME
  }

  /*
   * 事前ペアリング
   */
  onPressPairingStart = async () => {
    this.setState({ action: 1, peripheralId: null, peripheralName: null })
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
    await BleManager.scan([SERVICE_BLOOD_PRESSURE], 5, true)
    console.log('scan started')
  }

  async startReceivingNotification() {
    await BleManager.startNotification(
      this.peripheral.id,
      SERVICE_BLOOD_PRESSURE,
      CHARACTERISTIC_BLOOD_PRESSURE_MEASUREMENT,
    )
    console.log('startReceivingNotification')
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
      await this.connectAndOperate()
    }
  }

  connectAndOperate = async () => {
    const action = this.state.action
    try {
      await BleManager.connect(this.peripheral.id)
      if (action === 1) {
        // ペアリング時
        await BleManager.retrieveServices(this.peripheral.id)
        console.log('service retrieved')
        await this.syncTime()
        Alert.alert('', '血圧計とペアリングされました')
        await BleManager.disconnect(this.peripheral.id)
        return
      }

      // 測定後
      await BleManager.retrieveServices(this.peripheral.id)
      console.log('service retrieved')
      await this.syncTime()

      //このタイミングで初めてペアリングが行われた場合disconnectされてしまうため再度つなぎ直す
      await BleManager.connect(this.peripheral.id)
      await BleManager.retrieveServices(this.peripheral.id)

      if (this.state.device === DEVICE_UA651BLE) {
        await this.startReceivingNotification()
      }
    } catch (e) {
      console.log(e)
      return
    }
  }

  syncTime = async () => {
    const service = this.timeSettingService
    const characteristic = this.timeSettingCharacteristic
    console.log('service:', service)
    console.log('characteristic:', characteristic)
    if (this.state.device === DEVICE_UA651BLE) {
      // A&Dの場合は常に書き込む
      const data = timeByteDataForAAndD()
      console.log('timeByteDataForAAndD:', data)
      await BleManager.write(this.peripheral.id, service, characteristic, data)
      return
    }

    if (this.state.device === DEVICE_HEM9200T) {
      await BleManager.startNotification(this.peripheral.id, service, characteristic)
    }
  }

  /*
   * データを受け取った時
   */
  onReceiveCharacteristic = async (args) => {
    console.log('onReceiveCharacteristic args:', args)

    const characteristic = args.characteristic

    if (characteristic === standardCharacteristicUuid(CHARACTERISTIC_CURRENT_TIME)) {
      // omron bpmTimeを受け取った場合
      const timeValues = args.value
      console.log('timeValues:', timeValues)
      // const timeValues = await BleManager.read(this.peripheral.id, service, characteristic)
      const bpmTime = convertTimeValuesToDateForOmron(timeValues)
      const currentTime = new Date()
      const isSameDate = bpmTime.getDate() === currentTime.getDate()
      const minutesDiff = Math.floor(Math.abs((bpmTime.getTime() - currentTime.getTime()) / 1000 / 60))
      const hoursDiff = Math.floor(minutesDiff / 60)
      console.log(
        'isSameDate:', isSameDate,
        'minutesDiff:', minutesDiff,
        'hoursDiff:', hoursDiff,
      )
      if (
        isSameDate && minutesDiff >= 10   // 同じ日で10分以上差がある場合
        || !isSameDate && hoursDiff >= 24   // 日が異なり24時間以上差がある場合
      ) {
        // 機器の日付と端末の日付に差分がある場合は書き込む
        const data = timeByteDataForOmron()
        console.log('timeByteDataForOmron:', data)
        try {
          await BleManager.write(this.peripheral.id, this.timeSettingService, characteristic, data)
        } catch (e) {
          console.log(e)
        }
      }
      await this.startReceivingNotification()
    }

    if (characteristic === standardCharacteristicUuid(CHARACTERISTIC_BLOOD_PRESSURE_MEASUREMENT)) {
      // 測定値を受け取った場合
      const measurementValues = args.value
      console.log('measurementValues:', measurementValues)
      const measurement = parseMeasurementValues(measurementValues)
      console.log('measurement:', measurement)
      this.setState({
        measurements: [...this.state.measurements, measurement]
      })
    }
  }

  render() {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>
          React Native BLE Sandbox
        </Text>
        <View style={styles.device}>
          <Picker
            selectedValue={this.state.device}
            onValueChange={value => this.setState({ device: value })}
          >
            <Picker.Item label="A&D UA-651BLE" value={DEVICES.UA651BLE} />
            <Picker.Item label="Omron HEM-9200T" value={DEVICES.HEM9200T} />
          </Picker>
        </View>
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
                  <Text>脈拍数:{measurement.pulseRate}</Text>
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
  device: {
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
