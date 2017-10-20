import React, { Component } from 'react';
import BleManager from 'react-native-ble-manager';

import {
  Platform,
  StyleSheet,
  Text,
  View,
  Button,
} from 'react-native';

export default class App extends Component<{}> {

  componentDidMount() {
    (async () => {
      await BleManager.start()
      console.log('Ble module initialized')
    })()
  }

  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          React Native BLE Sandbox
        </Text>
        <Button
          title="Test"
          color="#4A93FF"
          onPress={() => {}}
          style={styles.button1}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    backgroundColor: '#F5FCFF',
    padding: 20,
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 30,
  },
  button1: {
    backgroundColor: '#ACDADE',
  },
});
